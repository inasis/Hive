import type { DaemonApiRequest } from "./daemon-api.js";

export type DaemonRequestPacket = DaemonApiRequest & { type: "request"; id: number };
export type DaemonResponsePacket = {
  type: "response";
  id: number | string;
  result?: unknown;
  error?: string;
};

/** Pack a validated API request in the established daemon RPC envelope. */
export function createDaemonRequestPacket(id: number, request: DaemonApiRequest): DaemonRequestPacket {
  return { type: "request", id, ...request };
}

export type DaemonServerPacket =
  | { type: "authenticated" }
  | { type: "event"; event: unknown }
  | DaemonResponsePacket
  | { type: "error"; error: string };

export type DaemonClientPacket =
  | { type: "authenticate"; token: string }
  | { type: "request"; id: number | string; method: string; params?: unknown };

/** Decode only the transport envelope; event and method-specific result payloads have their own validators. */
export function parseDaemonServerPacket(value: unknown): DaemonServerPacket | undefined {
  const packet = asRecord(value);
  if (!packet) return undefined;
  if (packet.type === "authenticated") return { type: "authenticated" };
  if (packet.type === "event") return { type: "event", event: packet.event };
  if (packet.type === "error" && typeof packet.error === "string") {
    return { type: "error", error: packet.error };
  }
  if (packet.type === "response" && (typeof packet.id === "number" || typeof packet.id === "string")) {
    return {
      type: "response",
      id: packet.id,
      ...(Object.hasOwn(packet, "result") ? { result: packet.result } : {}),
      ...(typeof packet.error === "string" ? { error: packet.error } : {}),
    };
  }
  return undefined;
}

/** Narrow authentication and RPC request envelopes received from a paired client. */
export function parseDaemonClientPacket(value: unknown): DaemonClientPacket | undefined {
  const packet = asRecord(value);
  if (!packet) return undefined;
  if (packet.type === "authenticate" && typeof packet.token === "string") {
    return { type: "authenticate", token: packet.token };
  }
  if (packet.type === "request" &&
      (typeof packet.id === "number" || typeof packet.id === "string") &&
      typeof packet.method === "string") {
    return {
      type: "request",
      id: packet.id,
      method: packet.method,
      ...(Object.hasOwn(packet, "params") ? { params: packet.params } : {}),
    };
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
