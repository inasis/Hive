import type { DaemonPeer } from "../../../../src/application/ports/daemon-peer.js";
import { isDaemonApiMethod } from "../../../../src/application/dto/daemon/daemon-api.js";
import { parseDaemonClientPacket } from "../../../../src/application/dto/daemon/daemon-transport.js";
import type { DaemonRequestDispatcher } from "../../../../src/application/services/daemon-api/dispatcher.js";

const AUTH_TIMEOUT_MS = 10_000;
const MAX_ACTIVE_REQUESTS = 64;

/** Authenticate a WSS peer and translate its JSON RPC messages to daemon API calls. */
export function handleDaemonPeer(
  peer: DaemonPeer,
  token: string,
  dispatch: DaemonRequestDispatcher,
  onAuthenticated: () => void,
  verifyToken: (candidate: string, expected: string) => boolean,
): void {
  let authenticated = false;
  let activeRequests = 0;
  const authTimer = setTimeout(() => peer.close(1008, "Authentication required"), AUTH_TIMEOUT_MS);
  peer.onClose(() => clearTimeout(authTimer));

  peer.onMessage(async (text) => {
    if (!authenticated) {
      let message: Record<string, unknown>;
      try { message = parseObject(text); }
      catch { peer.close(1008, "Invalid authentication message"); return; }
      const packet = parseDaemonClientPacket(message);
      if (packet?.type !== "authenticate" || !verifyToken(packet.token, token)) {
        peer.close(1008, "Authentication failed");
        return;
      }
      clearTimeout(authTimer);
      authenticated = true;
      onAuthenticated();
      peer.send({ type: "authenticated" });
      return;
    }

    let message: Record<string, unknown>;
    try { message = parseObject(text); }
    catch { peer.send({ type: "error", error: "Invalid request message" }); return; }
    const packet = parseDaemonClientPacket(message);
    if (packet?.type !== "request") {
      peer.send({ type: "error", error: "Unsupported daemon request" });
      return;
    }
    if (!isDaemonApiMethod(packet.method)) {
      // Keep the request correlated so the client can show the actual unsupported method
      // instead of waiting for its RPC timeout.
      peer.send({ type: "response", id: packet.id, error: `Unsupported daemon request: ${packet.method}` });
      return;
    }
    if (activeRequests >= MAX_ACTIVE_REQUESTS) {
      peer.send({ type: "response", id: packet.id, error: "Too many active requests" });
      return;
    }
    activeRequests += 1;
    try {
      const result = await dispatch(packet.method, packet.params);
      peer.send({ type: "response", id: packet.id, result });
    } catch (error) {
      peer.send({ type: "response", id: packet.id, error: errorMessage(error) });
    } finally {
      activeRequests -= 1;
    }
  });
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
