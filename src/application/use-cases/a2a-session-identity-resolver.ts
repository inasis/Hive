import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import { defaultHiveSessionName } from "../../domain/session-identity.js";
import type { HiveSessionIdentityDto } from "../dto/session-identity.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";
import type { A2ACallerAgentIdAllocator } from "./a2a-caller-agent-id-allocator.js";
import { resolveHiveSessionIdentity } from "./session-identity-resolution.js";

type A2ASessionIdentityResolverDependencies = {
  identityPort?: SessionIdentityPort;
  callerAgentIds: A2ACallerAgentIdAllocator;
};

/** Resolves one Hive identity from provider metadata, the identity store, or a fallback. */
export class A2ASessionIdentityResolver {
  constructor(private readonly dependencies: A2ASessionIdentityResolverDependencies) {}

  async resolve(adapter: AgentAdapter, session: NativeSession): Promise<HiveSessionIdentityDto> {
    const adapterMetadata = await adapter.ensureSessionMetadata?.(session);
    if (adapterMetadata) return adapterMetadata;

    const adapterIdentity = await adapter.ensureSessionIdentity?.(session);
    if (adapterIdentity) {
      return {
        hiveSessionId: adapterIdentity,
        sessionName: session.sessionName?.trim() || defaultHiveSessionName(adapterIdentity),
      };
    }

    if (this.dependencies.identityPort) {
      return resolveHiveSessionIdentity(
        this.dependencies.identityPort,
        adapter.provider,
        adapter.adapterId,
        session.sessionId,
        session.sessionName,
      );
    }

    const hiveSessionId = session.callerAgentId ?? this.dependencies.callerAgentIds.allocate();
    return {
      hiveSessionId,
      sessionName: session.sessionName?.trim() || defaultHiveSessionName(hiveSessionId),
    };
  }
}
