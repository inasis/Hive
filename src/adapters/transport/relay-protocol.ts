import type { RelayChannel, RelayRole } from "./relay-types.js";

export const RELAY_PROTOCOL_VERSION = 3;
export const MAX_RELAY_HANDSHAKE_BYTES = 4_096;
export const RELAY_PEER_WAIT_TIMEOUT_MS = 120_000;

export type RelayHandshake = {
  version: number;
  role: RelayRole;
  pairId: string;
  pairTag: string;
  channel: RelayChannel;
};
