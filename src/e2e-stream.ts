import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import type { HiveRelayTarget, RelayChannel } from "./tcp-relay.js";

const CONTROL_TIMEOUT_MS = 15_000;
const MAX_CONTROL_BYTES = 4_096;
const MAX_RECORD_PLAINTEXT = 64 * 1024;
const AUTH_TAG_BYTES = 16;
const MAX_RECORD_BYTES = MAX_RECORD_PLAINTEXT + AUTH_TAG_BYTES;

type RelayRole = "agent" | "client";
type SocketLike = Socket | TLSSocket;
type KeyPair = { publicKey: KeyObject; privateKey: KeyObject };
type DirectionKeys = {
  sendKey: Buffer;
  receiveKey: Buffer;
  sendLabel: string;
  receiveLabel: string;
  confirmKey: Buffer;
};

/** Authenticate the two peers with the pair token, then wrap the relay stream in E2E AES-GCM. */
export async function secureRelayStream(
  socket: SocketLike,
  target: HiveRelayTarget,
  role: RelayRole,
  channel: RelayChannel = "codex",
): Promise<Duplex> {
  const reader = new ControlReader(socket);
  try {
    const secret = Buffer.from(target.token, "utf8");
    const keys = role === "client"
      ? await clientHandshake(socket, reader, target, secret, channel)
      : await agentHandshake(socket, reader, target, secret, channel);
    reader.release();
    return new EncryptedRelayStream(socket, keys, target.pairId, channel);
  } catch (error) {
    reader.release();
    socket.destroy();
    throw error;
  }
}

/** A relay routing label; unlike the token, this does not allow decrypting or authenticating a peer. */
export function relayPairTag(target: HiveRelayTarget): string {
  return createHmac("sha256", Buffer.from(target.token, "utf8"))
    .update("hive-relay-room-v1|")
    .update(target.pairId)
    .digest("hex");
}

async function clientHandshake(
  socket: SocketLike,
  reader: ControlReader,
  target: HiveRelayTarget,
  secret: Buffer,
  channel: RelayChannel,
): Promise<DirectionKeys> {
  const clientKeys = createX25519KeyPair();
  const clientPublic = encodePublicKey(clientKeys);
  const clientNonce = randomBytes(32).toString("hex");
  const clientProof = mac(secret, clientHelloPayload(target.pairId, channel, clientNonce, clientPublic));
  writeControl(socket, { type: "client-hello", nonce: clientNonce, publicKey: clientPublic, proof: clientProof });

  const agentHello = await reader.readJson();
  expectType(agentHello, "agent-hello");
  const agentNonce = requiredString(agentHello.nonce, "agent nonce", /^[a-f0-9]{64}$/);
  const agentPublic = requiredString(agentHello.publicKey, "agent public key", /^[A-Za-z0-9+/]+={0,2}$/);
  const agentProof = requiredString(agentHello.proof, "agent proof", /^[a-f0-9]{64}$/);
  const expectedAgentProof = mac(secret, agentHelloPayload(target.pairId, channel, clientNonce, agentNonce, clientPublic, agentPublic));
  verifyMac(agentProof, expectedAgentProof);

  const sharedSecret = calculateSharedSecret(clientKeys, agentPublic);
  const keys = deriveDirectionKeys(sharedSecret, clientNonce, agentNonce, target.pairId, channel, "client");
  const transcript = handshakeTranscript(target.pairId, channel, clientNonce, agentNonce, clientPublic, agentPublic);
  writeControl(socket, { type: "client-finish", proof: mac(keys.confirmKey, "client-finish|" + transcript) });

  const agentFinish = await reader.readJson();
  expectType(agentFinish, "agent-finish");
  const agentFinishProof = requiredString(agentFinish.proof, "agent finish proof", /^[a-f0-9]{64}$/);
  verifyMac(agentFinishProof, mac(keys.confirmKey, "agent-finish|" + transcript));
  return keys;
}

async function agentHandshake(
  socket: SocketLike,
  reader: ControlReader,
  target: HiveRelayTarget,
  secret: Buffer,
  channel: RelayChannel,
): Promise<DirectionKeys> {
  const clientHello = await reader.readJson();
  expectType(clientHello, "client-hello");
  const clientNonce = requiredString(clientHello.nonce, "client nonce", /^[a-f0-9]{64}$/);
  const clientPublic = requiredString(clientHello.publicKey, "client public key", /^[A-Za-z0-9+/]+={0,2}$/);
  const clientProof = requiredString(clientHello.proof, "client proof", /^[a-f0-9]{64}$/);
  verifyMac(clientProof, mac(secret, clientHelloPayload(target.pairId, channel, clientNonce, clientPublic)));

  const agentKeys = createX25519KeyPair();
  const agentPublic = encodePublicKey(agentKeys);
  const agentNonce = randomBytes(32).toString("hex");
  writeControl(socket, {
    type: "agent-hello",
    nonce: agentNonce,
    publicKey: agentPublic,
    proof: mac(secret, agentHelloPayload(target.pairId, channel, clientNonce, agentNonce, clientPublic, agentPublic)),
  });

  const sharedSecret = calculateSharedSecret(agentKeys, clientPublic);
  const keys = deriveDirectionKeys(sharedSecret, clientNonce, agentNonce, target.pairId, channel, "agent");
  const transcript = handshakeTranscript(target.pairId, channel, clientNonce, agentNonce, clientPublic, agentPublic);
  const clientFinish = await reader.readJson();
  expectType(clientFinish, "client-finish");
  const clientFinishProof = requiredString(clientFinish.proof, "client finish proof", /^[a-f0-9]{64}$/);
  verifyMac(clientFinishProof, mac(keys.confirmKey, "client-finish|" + transcript));
  writeControl(socket, { type: "agent-finish", proof: mac(keys.confirmKey, "agent-finish|" + transcript) });
  return keys;
}

function createX25519KeyPair(): KeyPair {
  return generateKeyPairSync("x25519") as KeyPair;
}

function expectType(message: Record<string, unknown>, expected: string): void {
  if (message.type !== expected) throw new Error("Unexpected E2E handshake message");
}

function encodePublicKey(keyPair: KeyPair): string {
  return keyPair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function calculateSharedSecret(keyPair: KeyPair, encodedPublicKey: string): Buffer {
  const publicDer = Buffer.from(encodedPublicKey, "base64");
  if (publicDer.length !== 44 || publicDer.toString("base64") !== encodedPublicKey) {
    throw new Error("Invalid E2E public key");
  }
  const publicKey = createPublicKey({ key: publicDer, format: "der", type: "spki" });
  const sharedSecret = diffieHellman({ privateKey: keyPair.privateKey, publicKey });
  if (sharedSecret.length !== 32 || sharedSecret.every((byte) => byte === 0)) {
    throw new Error("Invalid E2E key agreement result");
  }
  return sharedSecret;
}

function deriveDirectionKeys(
  sharedSecret: Buffer,
  clientNonce: string,
  agentNonce: string,
  pairId: string,
  channel: RelayChannel,
  role: RelayRole,
): DirectionKeys {
  const salt = Buffer.concat([Buffer.from(clientNonce, "hex"), Buffer.from(agentNonce, "hex")]);
  const info = Buffer.from("hive-relay-e2e-v2|" + pairId + "|" + channel, "utf8");
  const material = Buffer.from(hkdfSync("sha256", sharedSecret, salt, info, 96));
  const clientToAgent = material.subarray(0, 32);
  const agentToClient = material.subarray(32, 64);
  const confirmKey = material.subarray(64, 96);
  return role === "client"
    ? { sendKey: clientToAgent, receiveKey: agentToClient, sendLabel: "client-to-agent", receiveLabel: "agent-to-client", confirmKey }
    : { sendKey: agentToClient, receiveKey: clientToAgent, sendLabel: "agent-to-client", receiveLabel: "client-to-agent", confirmKey };
}

function clientHelloPayload(pairId: string, channel: RelayChannel, nonce: string, publicKey: string): string {
  return "hive-relay-e2e-v2|client-hello|" + pairId + "|" + channel + "|" + nonce + "|" + publicKey;
}

function agentHelloPayload(pairId: string, channel: RelayChannel, clientNonce: string, agentNonce: string, clientPublic: string, agentPublic: string): string {
  return "hive-relay-e2e-v2|agent-hello|" + pairId + "|" + channel + "|" + clientNonce + "|" + agentNonce + "|" + clientPublic + "|" + agentPublic;
}

function handshakeTranscript(pairId: string, channel: RelayChannel, clientNonce: string, agentNonce: string, clientPublic: string, agentPublic: string): string {
  return pairId + "|" + channel + "|" + clientNonce + "|" + agentNonce + "|" + clientPublic + "|" + agentPublic;
}

function mac(key: Buffer, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

function verifyMac(actualHex: string, expectedHex: string): void {
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("E2E peer authentication failed; check that the pair URI matches");
  }
}

function requiredString(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("Invalid E2E " + label);
  return value;
}

function writeControl(socket: SocketLike, message: Record<string, string>): void {
  socket.write(JSON.stringify(message) + "\n");
}

class ControlReader {
  private buffer = Buffer.alloc(0);
  private waiting: { resolve: (message: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;
  private readonly onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_CONTROL_BYTES) {
      this.fail(new Error("E2E handshake exceeded the size limit"));
      return;
    }
    this.resolveLine();
  };
  private readonly onError = (error: Error): void => this.fail(error);
  private readonly onClose = (): void => this.fail(new Error("Relay closed during E2E handshake"));

  constructor(private readonly socket: SocketLike) {
    socket.on("data", this.onData);
    socket.once("error", this.onError);
    socket.once("close", this.onClose);
    socket.resume();
  }

  readJson(): Promise<Record<string, unknown>> {
    const line = this.takeLine();
    if (line !== undefined) return Promise.resolve(parseControl(line));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiting?.timer === timer) this.waiting = undefined;
        reject(new Error("Timed out during E2E peer authentication"));
      }, CONTROL_TIMEOUT_MS);
      this.waiting = { resolve, reject, timer };
      this.resolveLine();
    });
  }

  release(): void {
    if (this.waiting) {
      clearTimeout(this.waiting.timer);
      this.waiting.reject(new Error("E2E handshake reader closed"));
      this.waiting = undefined;
    }
    this.socket.pause();
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    if (this.buffer.length) this.socket.unshift(this.buffer);
    this.buffer = Buffer.alloc(0);
  }

  private takeLine(): string | undefined {
    const newline = this.buffer.indexOf(0x0a);
    if (newline < 0) return undefined;
    const line = this.buffer.subarray(0, newline).toString("utf8");
    this.buffer = this.buffer.subarray(newline + 1);
    return line;
  }

  private resolveLine(): void {
    if (!this.waiting) return;
    const line = this.takeLine();
    if (line === undefined) return;
    const waiting = this.waiting;
    this.waiting = undefined;
    clearTimeout(waiting.timer);
    try {
      waiting.resolve(parseControl(line));
    } catch (error) {
      waiting.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private fail(error: Error): void {
    if (!this.waiting) return;
    const waiting = this.waiting;
    this.waiting = undefined;
    clearTimeout(waiting.timer);
    waiting.reject(error);
  }
}

function parseControl(line: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Invalid E2E handshake message");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid E2E handshake message");
  }
  return value as Record<string, unknown>;
}

class EncryptedRelayStream extends Duplex {
  private receiveBuffer = Buffer.alloc(0);
  private sendSequence = 0n;
  private receiveSequence = 0n;
  private remoteEnded = false;
  private readonly onData = (chunk: Buffer): void => {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    this.readRecords();
  };
  private readonly onEnd = (): void => {
    if (this.receiveBuffer.length !== 0) {
      this.destroy(new Error("Truncated encrypted relay record"));
      return;
    }
    this.remoteEnded = true;
    this.push(null);
  };
  private readonly onError = (error: Error): void => {
    this.destroy(error);
  };
  private readonly onClose = (): void => {
    if (!this.remoteEnded && !this.destroyed) {
      this.destroy(new Error("Encrypted relay socket closed unexpectedly"));
    }
  };

  constructor(
    private readonly socket: SocketLike,
    private readonly keys: DirectionKeys,
    private readonly pairId: string,
    private readonly channel: RelayChannel,
  ) {
    super({ allowHalfOpen: false });
    socket.on("data", this.onData);
    socket.once("end", this.onEnd);
    socket.once("error", this.onError);
    socket.once("close", this.onClose);
  }

  override _read(): void {
    this.readRecords();
    this.socket.resume();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      const frames: Buffer[] = [];
      for (let offset = 0; offset < chunk.length; offset += MAX_RECORD_PLAINTEXT) {
        const plaintext = chunk.subarray(offset, Math.min(offset + MAX_RECORD_PLAINTEXT, chunk.length));
        frames.push(this.encryptRecord(plaintext));
      }
      if (frames.length === 0) {
        callback();
        return;
      }
      this.socket.write(Buffer.concat(frames), callback);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.socket.end(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.socket.off("data", this.onData);
    this.socket.off("end", this.onEnd);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    this.socket.destroy();
    callback(error);
  }

  private encryptRecord(plaintext: Buffer): Buffer {
    if (this.sendSequence > 0xffff_ffff_ffff_ffffn) throw new Error("E2E send sequence exhausted");
    const sequence = this.sendSequence++;
    const nonce = nonceFor(sequence);
    const cipher = createCipheriv("aes-256-gcm", this.keys.sendKey, nonce, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(recordAad(this.pairId, this.channel, this.keys.sendLabel, sequence));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const body = Buffer.concat([ciphertext, tag]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    return Buffer.concat([header, body]);
  }

  private readRecords(): void {
    while (this.receiveBuffer.length >= 4) {
      const length = this.receiveBuffer.readUInt32BE(0);
      if (length < AUTH_TAG_BYTES || length > MAX_RECORD_BYTES) {
        this.destroy(new Error("Invalid encrypted relay record size"));
        return;
      }
      if (this.receiveBuffer.length < length + 4) return;
      const record = this.receiveBuffer.subarray(4, length + 4);
      this.receiveBuffer = this.receiveBuffer.subarray(length + 4);
      try {
        const plaintext = this.decryptRecord(record);
        if (plaintext.length && !this.push(plaintext)) {
          this.socket.pause();
          return;
        }
      } catch {
        this.destroy(new Error("Encrypted relay authentication failed; the stream may have been modified"));
        return;
      }
    }
  }

  private decryptRecord(record: Buffer): Buffer {
    if (this.receiveSequence > 0xffff_ffff_ffff_ffffn) throw new Error("E2E receive sequence exhausted");
    const sequence = this.receiveSequence++;
    const ciphertext = record.subarray(0, record.length - AUTH_TAG_BYTES);
    const tag = record.subarray(record.length - AUTH_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.keys.receiveKey, nonceFor(sequence), { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(recordAad(this.pairId, this.channel, this.keys.receiveLabel, sequence));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

function nonceFor(sequence: bigint): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(sequence, 4);
  return nonce;
}

function recordAad(pairId: string, channel: RelayChannel, direction: string, sequence: bigint): Buffer {
  return Buffer.from("hive-relay-record-v2|" + pairId + "|" + channel + "|" + direction + "|" + sequence.toString(), "utf8");
}
