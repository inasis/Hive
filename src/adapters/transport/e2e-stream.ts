import { Duplex } from "node:stream";
import type { HiveRelayTarget, RelayChannel } from "./relay-types.js";
import { negotiateRelayKeys, relayPairTag, RelayHandshakeReader } from "./relay-e2e-handshake.js";
import type { RelayRole, RelaySocket } from "./relay-e2e-types.js";
import { EncryptedRelayStream } from "./relay-record-stream.js";

export { relayPairTag };

/** Authenticate the peers with the pair token, then wrap the socket in E2E AES-GCM records. */
export async function secureRelayStream(
  socket: RelaySocket,
  target: HiveRelayTarget,
  role: RelayRole,
  channel: RelayChannel = "codex",
): Promise<Duplex> {
  const reader = new RelayHandshakeReader(socket);
  try {
    const keys = await negotiateRelayKeys(socket, reader, target, role, channel);
    reader.release();
    return new EncryptedRelayStream(socket, keys, target.pairId, channel);
  } catch (error) {
    reader.release();
    socket.destroy();
    throw error;
  }
}
