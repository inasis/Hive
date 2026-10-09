import { createServer as createHttpsServer } from "node:https";
import { dispatchDaemonRequest, providerContexts, startConfiguredA2AHttpServer, stopA2AHttpServer, subscribeDaemonEvents } from "../../../../src/infrastructure/composition/daemon.js";
import type { SerializedBridgeEvent } from "../../../../src/application/dto/daemon/daemon-events.js";
import { handleDaemonPeer } from "../server/daemon-rpc.js";
import { attachDaemonWebSocketTransport, type DaemonWebSocketPeer } from "../../../../src/infrastructure/transport/daemon-websocket.js";
import { resolveWssDaemonConfiguration } from "../../../../src/infrastructure/transport/wss-daemon-configuration.js";
import { listPrivateIpv4Addresses } from "../../../../src/infrastructure/transport/daemon-security.js";
import { verifyDaemonToken } from "../../../../src/infrastructure/transport/daemon-token-verifier.js";

const daemonPeers = new Set<DaemonWebSocketPeer>();

/** Run the pinned WSS endpoint used by desktop and Android clients. */
export async function runHiveWssDaemon(publicUrl?: string): Promise<void> {
  const { host, port, endpoints, token, cert, key, fingerprint } = await resolveWssDaemonConfiguration(
    publicUrl === undefined ? {} : { publicUrl },
  );
  const server = createHttpsServer({ cert, key });
  const closePeers = attachDaemonWebSocketTransport(server, {
    onPeer: (peer) => {
      handleDaemonPeer(peer, token, dispatchDaemonRequest, () => daemonPeers.add(peer), verifyDaemonToken);
      peer.onClose(() => daemonPeers.delete(peer));
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      process.stdout.write(`Hive WSS daemon listening on ${host}:${port}\n`);
      const interfacesByAddress = new Map(listPrivateIpv4Addresses().map(({ name, address }) => [address, name]));
      for (const endpoint of endpoints) {
        const interfaceName = interfacesByAddress.get(new URL(endpoint).hostname);
        process.stdout.write(`WSS address${interfaceName ? ` (${interfaceName})` : ""}: ${endpoint}\n`);
      }
      process.stdout.write(`Certificate SHA-256: ${fingerprint}\n`);
      process.stdout.write(`Pairing token: ${token}\n`);
      resolve();
    });
  });

  subscribeDaemonEvents((event) => broadcastDaemonEvent(event));
  try {
    await startConfiguredA2AHttpServer();
  } catch (error) {
    closePeers();
    server.close();
    await providerContexts.openCode.closeAll();
    await providerContexts.pi.closeAll();
    throw error;
  }
  try {
    await providerContexts.openCode.warmLocal();
    process.stdout.write("OpenCode provider connected.\n");
  } catch (error) {
    process.stderr.write(`OpenCode startup failed: ${errorMessage(error)}\n`);
  }
  const shutdown = (): void => {
    closePeers();
    server.close();
    void stopA2AHttpServer();
    void providerContexts.openCode.closeAll();
    void providerContexts.pi.closeAll();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function broadcastDaemonEvent(event: SerializedBridgeEvent): void {
  for (const peer of daemonPeers) peer.send({ type: "event", event });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
