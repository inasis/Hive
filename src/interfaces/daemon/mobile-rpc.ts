import { timingSafeEqual } from "node:crypto";
import type { MobileDaemonPeer } from "../../application/ports/mobile-daemon-peer.js";
import { isDaemonApiMethod } from "../contracts/daemon-api.js";
import { parseDaemonClientPacket } from "../contracts/daemon-transport.js";
import type { DaemonRequestDispatcher } from "./dispatcher.js";

const AUTH_TIMEOUT_MS = 10_000;
const MAX_ACTIVE_REQUESTS = 64;

/** Authenticate a mobile peer and translate its JSON RPC messages to daemon API calls. */
export function handleMobileDaemonPeer(
  peer: MobileDaemonPeer,
  token: string,
  dispatch: DaemonRequestDispatcher,
  onAuthenticated: () => void,
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
      if (packet?.type !== "authenticate" || !secureCompare(packet.token, token)) {
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
    if (packet?.type !== "request" || !isDaemonApiMethod(packet.method)) {
      peer.send({ type: "error", error: "Unsupported mobile daemon request" });
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

function secureCompare(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const actualBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
