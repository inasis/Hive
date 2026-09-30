import { createCipheriv, createDecipheriv } from "node:crypto";
import { Duplex } from "node:stream";
import type { RelayChannel } from "./relay-types.js";
import type { RelayDirectionKeys, RelaySocket } from "./relay-e2e-types.js";

const MAX_RECORD_PLAINTEXT = 64 * 1024;
const AUTH_TAG_BYTES = 16;
const MAX_RECORD_BYTES = MAX_RECORD_PLAINTEXT + AUTH_TAG_BYTES;

/** Encrypt and authenticate bounded records over the authenticated relay socket. */
export class EncryptedRelayStream extends Duplex {
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
    private readonly socket: RelaySocket,
    private readonly keys: RelayDirectionKeys,
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
