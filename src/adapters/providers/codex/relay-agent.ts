import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Duplex } from "node:stream";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { codexAppServerArgs } from "../../transport/codex-process-transport.js";

/** Run the host's Codex app-server for the lifetime of one encrypted relay stream. */
export async function serveCodexRelaySession(stream: Duplex, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const child = spawn("codex", codexAppServerArgs(LOCAL_WORKSPACE_TARGET), { stdio: "pipe" });
  const onAbort = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  stream.pipe(child.stdin);
  child.stdout.pipe(stream);
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  try {
    await Promise.race([waitForClose(stream), waitForClose(child)]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    onAbort();
  }
}

function waitForClose(source: Duplex | ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    source.once("close", () => resolve());
    source.once("error", () => resolve());
  });
}
