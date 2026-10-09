import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { AssistantEvent } from "../ports/events.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";
import type { A2ARuntimeAdminPort } from "../ports/a2a-runtime.js";
import { resolveHiveSessionIdentity } from "./session-identity-resolution.js";

type A2ASessionLifecyclePort = Pick<A2ARuntimeAdminPort, "invalidateSessionDiscovery" | "markNativeSessionUnavailable">;

export type ProviderSessionLifecycleDependencies = {
  identities: SessionIdentityPort;
  a2aRuntime: A2ASessionLifecyclePort;
  a2aReady: Promise<void>;
};

/** Coordinates provider session events with Hive identity and A2A discovery state. */
export class ProviderSessionLifecycleCoordinator {
  constructor(private readonly dependencies: ProviderSessionLifecycleDependencies) {}

  onSessionCreated(): void {
    this.dependencies.a2aRuntime.invalidateSessionDiscovery();
  }

  async onSessionRenamed(provider: AssistantProvider, target: string, threadId: string, name: string): Promise<void> {
    await resolveHiveSessionIdentity(this.dependencies.identities, provider, target, threadId, name);
  }

  async onSessionDeleted(provider: AssistantProvider, target: string, threadId: string): Promise<void> {
    try {
      await this.dependencies.a2aReady;
      await this.dependencies.a2aRuntime.markNativeSessionUnavailable(provider, target, threadId);
    } catch {
      // Provider deletion already succeeded, so A2A state cleanup must not reverse its result.
    }
  }

  handleProviderEvent(event: AssistantEvent): void {
    if (event.type !== "threadDeleted" || !event.provider) return;
    void this.onSessionDeleted(event.provider, event.target, event.threadId);
  }
}
