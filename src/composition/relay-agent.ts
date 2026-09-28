import { parseHiveRelayTarget } from "../adapters/transport/relay-target.js";
import { runHiveRelayAgentTransport } from "../adapters/transport/relay-agent.js";

/** Own process signals and start the relay host's infrastructure services. */
export async function runHiveRelayAgent(targetValue: string): Promise<void> {
  const target = parseHiveRelayTarget(targetValue);
  if (!target) throw new Error("The daemon needs a hive+tcp:// or hive+tls:// relay target");

  const abort = new AbortController();
  const stop = (): void => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write("Hive host agent started for pair " + target.pairId + " (Codex, terminal, files)\n");
  try {
    await runHiveRelayAgentTransport(target, abort.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.write("Hive host agent stopped\n");
  }
}
