import { readFile } from "node:fs/promises";
import { connect as connectTcp, createServer as createTcpServer, type Server as TcpServer, type Socket } from "node:net";
import { createServer as createTlsServer, connect as connectTls, type TLSSocket } from "node:tls";
import { relayPairTag } from "./e2e-stream.js";

const PROTOCOL_VERSION = 3;
const MAX_HANDSHAKE_BYTES = 4_096;
const MAX_WAITING_PAIRS = 512;
const MAX_PENDING_HANDSHAKES = 256;
const PEER_WAIT_TIMEOUT_MS = 120_000;

export type HiveRelayTarget = {
  host: string;
  port: number;
  pairId: string;
  token: string;
  tls: boolean;
};

export type TcpRelayServerOptions = {
  host: string;
  port: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
};

type RelayRole = "agent" | "client";
export type RelayChannel = "codex" | "terminal" | "files";
type RelayPeer = { role: RelayRole; socket: Socket | TLSSocket; timer: NodeJS.Timeout };
type RelayRoom = { key: string; peers: Map<RelayRole, RelayPeer>; active: boolean };
type Handshake = { version: number; role: RelayRole; pairId: string; pairTag: string; channel: RelayChannel };

/** Parse a shared target URI: hive+tcp[s]://relay:port/<pair-id>?token=<secret>. */
export function parseHiveRelayTarget(value: string): HiveRelayTarget | undefined {
  if (!value.startsWith("hive+tcp://") && !value.startsWith("hive+tls://")) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Hive relay target URI");
  }
  const tls = url.protocol === "hive+tls:";
  if (!tls && url.protocol !== "hive+tcp:") throw new Error("Relay URI must use hive+tcp or hive+tls");
  if (url.username || url.password || url.hash) throw new Error("Relay URI must not contain user info or a fragment");
  const pairId = url.pathname.slice(1);
  const token = url.searchParams.get("token") ?? "";
  const port = Number(url.port);
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Relay URI must include a host and TCP port");
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(pairId)) throw new Error("Relay pair ID must be 8-128 letters, digits, '_' or '-'");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("Relay token must be 32-128 letters, digits, '_' or '-'");
  if (url.searchParams.size !== 1) throw new Error("Relay URI accepts only the token query parameter");
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  return { host, port, pairId, token, tls };
}

/** Open one authenticated relay stream and wait until the opposite peer joins. */
export function connectHiveRelay(
  target: HiveRelayTarget,
  role: RelayRole,
  signal?: AbortSignal,
  channel: RelayChannel = "codex",
): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Relay connection cancelled"));
      return;
    }
    const socket = target.tls
      ? connectTls({ host: target.host, port: target.port, ...(isIpAddress(target.host) ? {} : { servername: target.host }) })
      : connectTcp(target.port, target.host);
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the other Hive relay peer")), PEER_WAIT_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(socket);
      }
    };
    const onError = (error: Error): void => finish(error);
    const onClose = (): void => finish(new Error("Relay closed before pairing completed"));
    const onAbort = (): void => finish(new Error("Relay connection cancelled"));
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_HANDSHAKE_BYTES) {
        finish(new Error("Relay handshake exceeded the size limit"));
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      let response: { type?: string; message?: string };
      try {
        const parsed: unknown = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("Expected a relay response object");
        }
        response = parsed as { type?: string; message?: string };
      } catch {
        finish(new Error("Relay returned an invalid handshake"));
        return;
      }
      if (response.type !== "ready") {
        finish(new Error(response.message ?? "Relay rejected the connection"));
        return;
      }
      const remainder = buffer.subarray(newline + 1);
      socket.pause();
      if (remainder.length) socket.unshift(remainder);
      finish();
    };
    const sendHandshake = (): void => {
      const handshake: Handshake = { version: PROTOCOL_VERSION, role, pairId: target.pairId, pairTag: relayPairTag(target), channel };
      socket.write(JSON.stringify(handshake) + "\n");
    };
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (target.tls) socket.once("secureConnect", sendHandshake);
    else socket.once("connect", sendHandshake);
  });
}

/** Start a TCP relay that joins one authenticated Hive client to one host agent. */
export async function runTcpRelayServer(options: TcpRelayServerOptions): Promise<void> {
  const rooms = new Map<string, RelayRoom>();
  const pending = { handshakes: 0 };
  let server: TcpServer;
  if (options.tlsCertPath && options.tlsKeyPath) {
    const [cert, key] = await Promise.all([readFile(options.tlsCertPath), readFile(options.tlsKeyPath)]);
    server = createTlsServer({ cert, key }, (socket) => acceptRelaySocket(socket, rooms, pending));
  } else {
    server = createTcpServer((socket) => acceptRelaySocket(socket, rooms, pending));
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      process.stdout.write("Hive TCP relay listening on " + options.host + ":" + port + (options.tlsCertPath ? " (TLS)\n" : " (plain TCP)\n"));
      process.stdout.write("Peer streams use end-to-end encryption. The relay routes encrypted data and can observe connection metadata.\n");
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      server.close(() => resolve());
      for (const room of rooms.values()) {
        for (const peer of room.peers.values()) {
          clearTimeout(peer.timer);
          peer.socket.destroy();
        }
      }
      rooms.clear();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function acceptRelaySocket(
  socket: Socket | TLSSocket,
  rooms: Map<string, RelayRoom>,
  pending: { handshakes: number },
): void {
  if (pending.handshakes >= MAX_PENDING_HANDSHAKES) {
    socket.destroy();
    return;
  }
  pending.handshakes += 1;
  let counted = true;
  const releaseHandshakeSlot = (): void => {
    if (!counted) return;
    counted = false;
    pending.handshakes -= 1;
  };
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30_000);
  socket.pause();
  let buffer = Buffer.alloc(0);
  let done = false;
  const timer = setTimeout(() => reject("Relay handshake timed out"), 10_000);
  const reject = (message: string): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    releaseHandshakeSlot();
    socket.off("data", onData);
    socket.end(JSON.stringify({ type: "error", message }) + "\n");
  };
  const onData = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_HANDSHAKE_BYTES) {
      reject("Relay handshake exceeded the size limit");
      return;
    }
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) return;
    const remainder = buffer.subarray(newline + 1);
    let handshake: Handshake;
    try {
      const parsed: unknown = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Expected a relay handshake object");
      }
      handshake = parsed as Handshake;
    } catch {
      reject("Invalid relay handshake JSON");
      return;
    }
    if (
      handshake.version !== PROTOCOL_VERSION ||
      (handshake.role !== "agent" && handshake.role !== "client") ||
      (handshake.channel !== "codex" && handshake.channel !== "terminal" && handshake.channel !== "files") ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(handshake.pairId ?? "") ||
      !/^[a-f0-9]{64}$/.test(handshake.pairTag ?? "")
    ) {
      reject("Invalid relay handshake fields");
      return;
    }
    done = true;
    clearTimeout(timer);
    releaseHandshakeSlot();
    socket.off("data", onData);
    socket.pause();
    if (remainder.length) socket.unshift(remainder);
    joinRoom(socket, handshake, rooms);
  };
  socket.on("data", onData);
  socket.once("close", releaseHandshakeSlot);
  socket.once("error", () => socket.destroy());
  socket.resume();
}

function joinRoom(socket: Socket | TLSSocket, handshake: Handshake, rooms: Map<string, RelayRoom>): void {
  const key = handshake.pairId + ":" + handshake.pairTag + ":" + handshake.channel;
  let room = rooms.get(key);
  if (!room) {
    if (rooms.size >= MAX_WAITING_PAIRS) {
      socket.end(JSON.stringify({ type: "error", message: "Relay is at capacity" }) + "\n");
      return;
    }
    room = { key, peers: new Map(), active: false };
    rooms.set(key, room);
  }
  if (room.active || room.peers.has(handshake.role)) {
    socket.end(JSON.stringify({ type: "error", message: "A " + handshake.role + " is already connected" }) + "\n");
    return;
  }

  const timer = setTimeout(() => {
    socket.end(JSON.stringify({ type: "error", message: "Timed out waiting for the matching Hive peer" }) + "\n");
    removePeer(room!, handshake.role, rooms);
  }, PEER_WAIT_TIMEOUT_MS);
  const peer: RelayPeer = { role: handshake.role, socket, timer };
  room.peers.set(handshake.role, peer);
  socket.once("error", () => removePeer(room!, handshake.role, rooms));
  socket.once("close", () => removePeer(room!, handshake.role, rooms));

  const otherRole: RelayRole = handshake.role === "agent" ? "client" : "agent";
  const other = room.peers.get(otherRole);
  if (!other) return;
  clearTimeout(peer.timer);
  clearTimeout(other.timer);
  room.active = true;
  peer.socket.write(JSON.stringify({ type: "ready" }) + "\n");
  other.socket.write(JSON.stringify({ type: "ready" }) + "\n");
  peer.socket.pipe(other.socket);
  other.socket.pipe(peer.socket);
  peer.socket.resume();
  other.socket.resume();
}

function removePeer(room: RelayRoom, role: RelayRole, rooms: Map<string, RelayRoom>): void {
  const peer = room.peers.get(role);
  if (peer) clearTimeout(peer.timer);
  room.peers.delete(role);
  if (room.active) {
    room.active = false;
    const otherRole: RelayRole = role === "agent" ? "client" : "agent";
    const other = room.peers.get(otherRole);
    if (other) {
      room.peers.delete(otherRole);
      clearTimeout(other.timer);
      other.socket.destroy();
    }
  }
  if (room.peers.size === 0) rooms.delete(room.key);
}

function isIpAddress(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(":");
}
