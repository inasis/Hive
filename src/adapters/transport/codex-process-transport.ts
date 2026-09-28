import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { secureRelayStream } from "./e2e-stream.js";
import { connectHiveRelay } from "./relay-client.js";
import { parseHiveRelayTarget } from "./relay-target.js";
import type { HiveRelayTarget } from "./relay-types.js";
import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import { assertSshTarget } from "./workspace-target.js";

export type CodexRpcTransport = {
  input: Readable;
  output: Writable;
  label: string;
  stderr?: Readable;
  end: () => void;
  terminate: () => void;
  subscribeExit: (listener: (message: string) => void) => void;
};

/** Start the Codex app-server locally, over SSH, or through the encrypted Hive relay. */
export async function connectCodexProcessTransport(target: string): Promise<CodexRpcTransport> {
  const relayTarget = parseHiveRelayTarget(target);
  if (target === LOCAL_WORKSPACE_TARGET) return localTransport();
  if (relayTarget) return relayTransport(relayTarget);
  return sshTransport(target);
}

function localTransport(): CodexRpcTransport {
  const command = process.platform === "win32" ? "codex.cmd" : "codex";
  const child: ChildProcessWithoutNullStreams = spawn(command, ["app-server"], {
    stdio: "pipe",
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
  return {
    input: child.stdout,
    output: child.stdin,
    stderr: child.stderr,
    label: "Local Codex app-server",
    end: () => child.stdin.end(),
    terminate: () => child.kill("SIGTERM"),
    subscribeExit: (listener) => {
      child.on("error", (error) => listener(error.message));
      child.on("exit", (code, signal) => listener(String(signal ?? code ?? "unknown status")));
    },
  };
}

function sshTransport(target: string): CodexRpcTransport {
  assertSshTarget(target);
  const child: ChildProcessWithoutNullStreams = spawn(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "--",
      target,
      "bash -lc 'PATH=\"$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH\"; for codex_bin in \"$HOME\"/.nvm/versions/node/*/bin/codex; do [ -x \"$codex_bin\" ] && PATH=\"$(dirname \"$codex_bin\"):$PATH\"; done; export PATH; exec codex app-server'",
    ],
    { stdio: "pipe" },
  );
  return {
    input: child.stdout,
    output: child.stdin,
    stderr: child.stderr,
    label: "Remote Codex app-server",
    end: () => child.stdin.end(),
    terminate: () => child.kill("SIGTERM"),
    subscribeExit: (listener) => {
      child.on("error", (error) => listener(error.message));
      child.on("exit", (code, signal) => listener(String(signal ?? code ?? "unknown status")));
    },
  };
}

async function relayTransport(target: HiveRelayTarget): Promise<CodexRpcTransport> {
  const socket = await connectHiveRelay(target, "client");
  const stream = await secureRelayStream(socket, target, "client");
  return {
    input: stream,
    output: stream,
    label: "Hive relay connection",
    end: () => stream.end(),
    terminate: () => stream.destroy(),
    subscribeExit: (listener) => {
      stream.once("error", (error) => listener(error.message));
      stream.once("close", () => listener("encrypted relay stream closed"));
    },
  };
}
