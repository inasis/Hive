import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import type { MobileDaemonPeer } from "../../application/ports/mobile-daemon-peer.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type MobileWebSocketPeer = MobileDaemonPeer;

type Peer = {
  socket: Duplex;
  buffer: Buffer;
  closed: boolean;
  onMessage?: (text: string) => void | Promise<void>;
  closeListeners: Set<() => void>;
};

/** Attach the raw RFC 6455 framing used by the mobile daemon's JSON RPC socket. */
export function attachMobileWebSocketTransport(server: HttpsServer, options: {
  isOriginAllowed(origin: string | undefined): boolean;
  onPeer(peer: MobileWebSocketPeer): void;
  maxPeers?: number;
}): () => void {
  const peers = new Set<Peer>();

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!options.isOriginAllowed(request.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const websocketKey = request.headers["sec-websocket-key"];
    if (request.url !== "/rpc" || request.headers.upgrade?.toLowerCase() !== "websocket" ||
        typeof websocketKey !== "string" || peers.size >= (options.maxPeers ?? 8)) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }

    const accept = createWebSocketAccept(websocketKey);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);

    const peer: Peer = { socket, buffer: Buffer.alloc(0), closed: false, closeListeners: new Set() };
    peers.add(peer);
    const publicPeer: MobileWebSocketPeer = {
      onMessage: (listener) => { peer.onMessage = listener; },
      onClose: (listener) => {
        if (peer.closed) listener();
        else peer.closeListeners.add(listener);
      },
      send: (value) => sendJson(peer, value),
      close: (code, reason) => closePeer(peer, code, reason),
    };

    socket.on("data", (chunk) => receiveFrames(peer, chunk));
    socket.once("close", () => {
      peer.closed = true;
      peers.delete(peer);
      for (const listener of peer.closeListeners) listener();
      peer.closeListeners.clear();
    });
    socket.once("error", () => closePeer(peer, 1011, "Socket error"));
    options.onPeer(publicPeer);
    if (head.length) socket.emit("data", head);
  };

  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    for (const peer of peers) closePeer(peer, 1001, "Hive daemon stopped");
  };
}

function createWebSocketAccept(key: string): string {
  return createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
}

function receiveFrames(peer: Peer, chunk: Buffer): void {
  if (peer.closed) return;
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  if (peer.buffer.length > MAX_FRAME_BYTES + 14) { closePeer(peer, 1009, "Message too large"); return; }
  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0]!;
    const second = peer.buffer[1]!;
    const final = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (!final || (first & 0x70) !== 0 || !masked) { closePeer(peer, 1002, "Unsupported WebSocket frame"); return; }
    if (length === 126) {
      if (peer.buffer.length < 4) return;
      length = peer.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (peer.buffer.length < 10) return;
      const largeLength = peer.buffer.readBigUInt64BE(2);
      if (largeLength > BigInt(MAX_FRAME_BYTES)) { closePeer(peer, 1009, "Message too large"); return; }
      length = Number(largeLength);
      offset = 10;
    }
    if (length > MAX_FRAME_BYTES) { closePeer(peer, 1009, "Message too large"); return; }
    if (peer.buffer.length < offset + 4 + length) return;
    const mask = peer.buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(peer.buffer.subarray(offset + 4, offset + 4 + length));
    peer.buffer = peer.buffer.subarray(offset + 4 + length);
    for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
    if (opcode === 8) { closePeer(peer, 1000, "Closed"); return; }
    if (opcode === 9) { writeFrame(peer, 10, payload); continue; }
    if (opcode === 10) continue;
    if (opcode !== 1) { closePeer(peer, 1003, "Text frames required"); return; }
    void peer.onMessage?.(payload.toString("utf8"));
  }
}

function sendJson(peer: Peer, value: unknown): void {
  if (!peer.closed && !peer.socket.destroyed) writeFrame(peer, 1, Buffer.from(JSON.stringify(value), "utf8"));
}

function writeFrame(peer: Peer, opcode: number, payload: Buffer): void {
  if (peer.closed || peer.socket.destroyed) return;
  let header: Buffer;
  if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length]);
  else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  peer.socket.write(Buffer.concat([header, payload]));
}

function closePeer(peer: Peer, code: number, reason: string): void {
  if (peer.closed) return;
  if (!peer.socket.destroyed) {
    const reasonBytes = Buffer.from(reason).subarray(0, 120);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0); reasonBytes.copy(payload, 2);
    writeFrame(peer, 8, payload);
    peer.socket.end();
  }
  peer.closed = true;
}
