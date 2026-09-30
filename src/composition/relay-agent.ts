import { serveCodexRelaySession } from "../adapters/providers/codex/relay-agent.js";
import { serveRelayAgentTerminal } from "../adapters/terminal/relay-agent.js";
import { RoutedWorkspaceFileAdapter } from "../adapters/workspace/files.js";
import { serveRelayAgentWorkspaceFiles } from "../adapters/workspace/relay-agent.js";
import { parseHiveRelayTarget } from "../adapters/transport/relay-target.js";
import { runHiveRelayAgentTransport } from "../adapters/transport/relay-agent.js";
import { startConfiguredA2AHttpServer, stopA2AHttpServer, stopOpenCodeProvider } from "./daemon.js";

/** Own process signals and start the relay host's infrastructure services. */
export async function runHiveRelayAgent(targetValue: string): Promise<void> {
  const target = parseHiveRelayTarget(targetValue);
  if (!target) throw new Error("The daemon needs a hive+tcp:// or hive+tls:// relay target");

  const abort = new AbortController();
  const workspaceFiles = new RoutedWorkspaceFileAdapter();
  const stop = (): void => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write("Hive host agent started for pair " + target.pairId + " (Codex, terminal, files)\n");
  try {
    await startConfiguredA2AHttpServer();
    await runHiveRelayAgentTransport(target, abort.signal, {
      codex: serveCodexRelaySession,
      terminal: serveRelayAgentTerminal,
      files: (stream) => serveRelayAgentWorkspaceFiles(stream, workspaceFiles),
    });
  } finally {
    await stopA2AHttpServer();
    await stopOpenCodeProvider();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.write("Hive host agent stopped\n");
  }
}
