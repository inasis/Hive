import type { Duplex } from "node:stream";
import { secureRelayStream } from "../transport/e2e-stream.js";
import { connectHiveRelay } from "../transport/relay-client.js";
import type { HiveRelayTarget } from "../transport/relay-types.js";
import { MAX_WORKSPACE_RESPONSE_BYTES } from "./file-limits.js";

/** Request a directory listing or a file preview through the daemon's encrypted files channel. */
export async function requestRelayWorkspaceFile(
  target: HiveRelayTarget,
  operation: "list" | "read",
  cwd: string,
  path: string,
): Promise<unknown> {
  const socket = await connectHiveRelay(target, "client", undefined, "files");
  const stream = await secureRelayStream(socket, target, "client", "files");
  try {
    const response = await exchangeJsonLine(stream, { operation, cwd, path });
    if (typeof response !== "object" || response === null || Array.isArray(response)) {
      throw new Error("Relay daemon returned invalid workspace data");
    }
    const record = response as Record<string, unknown>;
    if (typeof record.error === "string") throw new Error(record.error);
    return response;
  } finally {
    stream.destroy();
  }
}

async function exchangeJsonLine(stream: Duplex, request: Record<string, string>): Promise<unknown> {
  return await new Promise((resolveResponse, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the relay daemon")), 30_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
      stream.off("close", onClose);
    };
    const finish = (error?: Error, value?: unknown): void => {
      cleanup();
      if (error) reject(error);
      else resolveResponse(value);
    };
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_WORKSPACE_RESPONSE_BYTES) {
        finish(new Error("Relay workspace response exceeded the size limit"));
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      try {
        finish(undefined, JSON.parse(buffer.subarray(0, newline).toString("utf8")) as unknown);
      } catch {
        finish(new Error("Relay daemon returned invalid workspace data"));
      }
    };
    const onError = (error: Error): void => finish(error);
    const onEnd = (): void => finish(new Error("Relay daemon closed before replying"));
    const onClose = (): void => finish(new Error("Relay daemon closed before replying"));
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
    stream.once("close", onClose);
    stream.write(JSON.stringify(request) + "\n");
  });
}
