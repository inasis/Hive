import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { secureRelayStream } from "./e2e-stream.js";
import { connectHiveRelay } from "./relay-client.js";
import type { HiveRelayTarget, RelayChannel } from "./relay-types.js";

export type RelayAgentServices = {
  codex: (stream: Duplex, signal: AbortSignal) => Promise<void>;
  terminal: (stream: Duplex) => Promise<void>;
  files: (stream: Duplex) => Promise<void>;
};

/** Keep the relay channels open and delegate each channel to its owning adapter. */
export async function runHiveRelayAgentTransport(
  target: HiveRelayTarget,
  signal: AbortSignal,
  services: RelayAgentServices,
): Promise<void> {
  await Promise.all([
    runCodexAgent(target, signal, services.codex),
    runRelayService(target, "terminal", signal, services.terminal),
    runRelayService(target, "files", signal, services.files),
  ]);
}

async function runCodexAgent(
  target: HiveRelayTarget,
  signal: AbortSignal,
  serve: RelayAgentServices["codex"],
): Promise<void> {
  while (!signal.aborted) {
    let activeSocket: Socket | TLSSocket | undefined;
    let activeStream: Duplex | undefined;
    const onAbort = (): void => {
      activeStream?.destroy();
      activeSocket?.destroy();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      activeSocket = await connectHiveRelay(target, "agent", signal, "codex");
      activeStream = await secureRelayStream(activeSocket, target, "agent", "codex");
      if (signal.aborted) break;
      process.stdout.write("Hive relay client connected; starting local Codex app-server\n");
      await serve(activeStream, signal);
      process.stdout.write("Hive Codex relay session ended\n");
    } catch (error) {
      if (!signal.aborted) process.stderr.write("Hive Codex relay failed: " + errorMessage(error) + "\n");
    } finally {
      signal.removeEventListener("abort", onAbort);
      activeStream?.destroy();
      activeSocket?.destroy();
    }
    await delayUnlessAborted(signal, 1_500);
  }
}

async function runRelayService(
  target: HiveRelayTarget,
  channel: Exclude<RelayChannel, "codex">,
  signal: AbortSignal,
  serve: RelayAgentServices["files"],
): Promise<void> {
  while (!signal.aborted) {
    let activeSocket: Socket | TLSSocket | undefined;
    let activeStream: Duplex | undefined;
    const onAbort = (): void => {
      activeStream?.destroy();
      activeSocket?.destroy();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      activeSocket = await connectHiveRelay(target, "agent", signal, channel);
      activeStream = await secureRelayStream(activeSocket, target, "agent", channel);
      if (!signal.aborted) await serve(activeStream);
    } catch (error) {
      if (!signal.aborted) process.stderr.write(`Hive ${channel} relay failed: ${errorMessage(error)}\n`);
    } finally {
      signal.removeEventListener("abort", onAbort);
      activeStream?.destroy();
      activeSocket?.destroy();
    }
    await delayUnlessAborted(signal, 1_000);
  }
}

function delayUnlessAborted(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => finish();
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
