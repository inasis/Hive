import type { AssistantEvent } from "../../application/ports/events.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { encodeHiveSessionAddressKey, type HiveSessionAddress } from "./hive-session-agent-address.js";

/** Tracks active native provider turns independently from A2A task bookkeeping. */
export class HiveSessionNativeTurnActivity {
  private readonly nativeTurns = new Map<string, string | undefined>();

  constructor(private readonly provider: AssistantProvider) {}

  isBusy(address: HiveSessionAddress): boolean {
    return this.nativeTurns.has(encodeHiveSessionAddressKey(address));
  }

  onNativeSessionDeleted(address: HiveSessionAddress): void {
    this.nativeTurns.delete(encodeHiveSessionAddressKey(address));
  }

  observe(event: AssistantEvent): void {
    if (event.provider !== this.provider) return;
    const key = encodeHiveSessionAddressKey({ target: event.target, threadId: event.threadId });
    if (event.type === "turnStarted") {
      this.nativeTurns.set(key, event.turnId);
      return;
    }
    if (event.type !== "turnCompleted") return;
    const activeTurnId = this.nativeTurns.get(key);
    if (event.turnId && activeTurnId && event.turnId !== activeTurnId) return;
    this.nativeTurns.delete(key);
  }
}
