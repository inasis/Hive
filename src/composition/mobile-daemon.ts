import { createServer as createHttpsServer } from "node:https";
import { dispatchDaemonRequest, stopOpenCodeProvider, subscribeDaemonEvents, warmOpenCodeProvider } from "./daemon.js";
import type { BridgeEvent } from "../interfaces/contracts/daemon-events.js";
import { handleMobileDaemonPeer } from "../interfaces/daemon/mobile-rpc.js";
import { attachMobileWebSocketTransport, type MobileWebSocketPeer } from "../adapters/transport/mobile-websocket.js";
import { getMobileToken, getPublicEndpoints, getTlsMaterial, listPrivateIpv4Addresses } from "../adapters/transport/mobile-security.js";

const mobilePeers = new Set<MobileWebSocketPeer>();

/** Run the standalone WSS endpoint used by the Capacitor client. */
export async function runHiveMobileDaemon(): Promise<void> {
  const bind = process.env.HIVE_MOBILE_BIND?.trim() || "0.0.0.0:4753";
  const certificatePath = process.env.HIVE_MOBILE_TLS_CERT?.trim();
  const privateKeyPath = process.env.HIVE_MOBILE_TLS_KEY?.trim();
  if (Boolean(certificatePath) !== Boolean(privateKeyPath)) {
    throw new Error("Set both HIVE_MOBILE_TLS_CERT and HIVE_MOBILE_TLS_KEY, or let Hive create its local certificate");
  }
  const { host, port } = parseBindAddress(bind);
  const endpoints = getPublicEndpoints(host, port, process.env.HIVE_MOBILE_PUBLIC_URL?.trim());
  const token = await getMobileToken(process.env.HIVE_MOBILE_TOKEN?.trim());
  const { cert, key, fingerprint } = await getTlsMaterial(endpoints, certificatePath, privateKeyPath);
  const server = createHttpsServer({ cert, key });
  const closePeers = attachMobileWebSocketTransport(server, {
    isOriginAllowed: isAllowedOrigin,
    onPeer: (peer) => {
      handleMobileDaemonPeer(peer, token, dispatchDaemonRequest, () => mobilePeers.add(peer));
      peer.onClose(() => mobilePeers.delete(peer));
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      process.stdout.write(`Hive Android daemon listening on ${host}:${port}\n`);
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

  subscribeDaemonEvents((event) => broadcastMobileEvent(event));
  const shutdown = (): void => {
    closePeers();
    server.close();
    void stopOpenCodeProvider();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await warmOpenCodeProvider();
    process.stdout.write("OpenCode provider connected.\n");
  } catch (error) {
    process.stderr.write(`OpenCode startup failed: ${errorMessage(error)}\n`);
  }
}

function broadcastMobileEvent(event: BridgeEvent): void {
  for (const peer of mobilePeers) peer.send({ type: "event", event });
}

function parseBindAddress(value: string): { host: string; port: number } {
  const match = value.startsWith("[") ? /^\[([^\]]+)\]:(\d+)$/.exec(value) : /^(.+):(\d+)$/.exec(value);
  const port = match ? Number(match[2]) : NaN;
  if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("HIVE_MOBILE_BIND must be an address such as 0.0.0.0:4753 or [::]:4753");
  }
  return { host: match[1]!, port };
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.protocol === "capacitor:";
  } catch { return false; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
