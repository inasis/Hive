import type { Duplex } from "node:stream";

export type RelayAgentMessage = Record<string, unknown>;

/** Decode bounded newline-delimited JSON control messages from a relay service stream. */
export async function* readRelayAgentMessages(
  stream: Duplex,
  maxLineBytes = 256 * 1024,
): AsyncGenerator<RelayAgentMessage> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > maxLineBytes && buffer.indexOf(0x0a) < 0) {
      throw new Error("Relay control message exceeded the size limit");
    }
    while (true) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (line.length > maxLineBytes) throw new Error("Relay control message exceeded the size limit");
      let value: unknown;
      try {
        value = JSON.parse(line.toString("utf8"));
      } catch {
        throw new Error("Invalid relay control message");
      }
      if (!isRecord(value)) throw new Error("Invalid relay control message");
      yield value;
    }
  }
}

export function writeRelayAgentMessage(stream: Duplex, message: RelayAgentMessage): void {
  if (!stream.destroyed && stream.writable) stream.write(JSON.stringify(message) + "\n");
}

export function writeRelayAgentMessageAndEnd(stream: Duplex, message: RelayAgentMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed || !stream.writable) { resolve(); return; }
    stream.end(JSON.stringify(message) + "\n", (error?: Error | null) => error ? reject(error) : resolve());
  });
}

function isRecord(value: unknown): value is RelayAgentMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
