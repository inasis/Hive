import { runTcpRelayServer, type TcpRelayServerOptions } from "../adapters/transport/tcp-relay-server.js";

/** Own process signals while the transport adapter runs the TCP relay server. */
export async function runHiveRelayServer(options: TcpRelayServerOptions): Promise<void> {
  const abort = new AbortController();
  const stop = (): void => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runTcpRelayServer(options, abort.signal, ({ host, port, tls }) => {
      process.stdout.write("Hive TCP relay listening on " + host + ":" + port + (tls ? " (TLS)\n" : " (plain TCP)\n"));
      process.stdout.write("Peer streams use end-to-end encryption. The relay routes encrypted data and can observe connection metadata.\n");
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
