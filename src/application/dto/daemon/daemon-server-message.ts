import { parseBridgeEvent, type BridgeEvent } from "./daemon-events.js";
import { parseDaemonServerPacket, type DaemonResponsePacket } from "./daemon-transport.js";

export type DaemonServerMessage =
  | { type: "authenticated" }
  | { type: "event"; event: BridgeEvent }
  | { type: "response"; packet: DaemonResponsePacket }
  | { type: "error"; message: string };

/** Validate a serialized daemon message and its bridge event payload. */
export function parseDaemonServerMessage(data: string): DaemonServerMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }

  const packet = parseDaemonServerPacket(value);
  if (!packet) return undefined;
  if (packet.type === "authenticated") return { type: "authenticated" };
  if (packet.type === "event") {
    const event = parseBridgeEvent(packet.event);
    return event ? { type: "event", event } : undefined;
  }
  if (packet.type === "response") return { type: "response", packet };
  return { type: "error", message: packet.error };
}
