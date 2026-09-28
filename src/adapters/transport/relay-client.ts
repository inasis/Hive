import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { relayPairTag } from "./e2e-stream.js";
import type { HiveRelayTarget, RelayChannel, RelayRole } from "./relay-types.js";
import {
  MAX_RELAY_HANDSHAKE_BYTES,
  RELAY_PEER_WAIT_TIMEOUT_MS,
  RELAY_PROTOCOL_VERSION,
  type RelayHandshake,
} from "./relay-protocol.js";

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
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the other Hive relay peer")), RELAY_PEER_WAIT_TIMEOUT_MS);
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
      if (buffer.length > MAX_RELAY_HANDSHAKE_BYTES) {
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
      const handshake: RelayHandshake = { version: RELAY_PROTOCOL_VERSION, role, pairId: target.pairId, pairTag: relayPairTag(target), channel };
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
function isIpAddress(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(":");
}
