import { readFile } from "node:fs/promises";
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from "node:net";
import { createServer as createTlsServer, type TLSSocket } from "node:tls";
import { relayPairTag } from "./e2e-stream.js";
import type { RelayChannel, RelayRole } from "./relay-types.js";
import {
  MAX_RELAY_HANDSHAKE_BYTES,
  RELAY_PEER_WAIT_TIMEOUT_MS,
  RELAY_PROTOCOL_VERSION,
  type RelayHandshake,
} from "./relay-protocol.js";

const MAX_WAITING_PAIRS = 512;
const MAX_PENDING_HANDSHAKES = 256;

export type TcpRelayServerOptions = {
  host: string;
  port: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
};
export type TcpRelayServerAddress = { host: string; port: number; tls: boolean };

type RelayPeer = { role: RelayRole; socket: Socket | TLSSocket; timer: NodeJS.Timeout };
type RelayRoom = { key: string; peers: Map<RelayRole, RelayPeer>; active: boolean };

/** Start a TCP relay that joins one authenticated Hive client to one host agent. */
export async function runTcpRelayServer(
  options: TcpRelayServerOptions,
  signal: AbortSignal,
  onListening: (address: TcpRelayServerAddress) => void,
): Promise<void> {
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
      onListening({ host: options.host, port, tls: Boolean(options.tlsCertPath) });
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      signal.removeEventListener("abort", stop);
      server.close(() => resolve());
      for (const room of rooms.values()) {
        for (const peer of room.peers.values()) {
          clearTimeout(peer.timer);
          peer.socket.destroy();
        }
      }
      rooms.clear();
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
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
    if (buffer.length > MAX_RELAY_HANDSHAKE_BYTES) {
      reject("Relay handshake exceeded the size limit");
      return;
    }
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) return;
    const remainder = buffer.subarray(newline + 1);
    let handshake: RelayHandshake;
    try {
      const parsed: unknown = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Expected a relay handshake object");
      }
      handshake = parsed as RelayHandshake;
    } catch {
      reject("Invalid relay handshake JSON");
      return;
    }
    if (
      handshake.version !== RELAY_PROTOCOL_VERSION ||
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

function joinRoom(socket: Socket | TLSSocket, handshake: RelayHandshake, rooms: Map<string, RelayRoom>): void {
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
  }, RELAY_PEER_WAIT_TIMEOUT_MS);
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
