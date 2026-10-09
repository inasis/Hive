import type { AgentNode, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { A2ARuntimeSnapshot } from "../dto/a2a-runtime-snapshot.js";
import { defaultHiveSessionName } from "../../domain/session-identity.js";
import type { HiveSessionIdentityDto } from "../dto/session-identity.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { A2ACallerAgentIdAllocator } from "./a2a-caller-agent-id-allocator.js";
import { copyAgent } from "../validation/a2a-runtime-copy.js";

type A2ASessionIdentityRestorerServices = {
  adapterForAgent(agent: AgentNode): AgentAdapter | undefined;
  resolveIdentity(adapter: AgentAdapter, session: NativeSession): Promise<HiveSessionIdentityDto>;
  callerAgentIds: A2ACallerAgentIdAllocator;
  storeRestoredSession(agentId: string, session: NativeSession, agent: AgentNode | undefined): void;
};

/** Reconciles persisted session identities with current adapter identity sources. */
export class A2ASessionIdentityRestorer {
  constructor(private readonly services: A2ASessionIdentityRestorerServices) {}

  async restore(snapshot: A2ARuntimeSnapshot): Promise<boolean> {
    const reservedSessionIds = new Set([
      ...snapshot.agents.map((agent) => agent.agentId),
      ...snapshot.sessions.flatMap(({ session }) => session.callerAgentId ? [session.callerAgentId] : []),
    ]);
    const usedCallerAgentIds = new Set<string>();
    let updated = false;

    for (const { agentId, session: savedSession } of snapshot.sessions) {
      const agent = snapshot.agents.find((candidate) => candidate.agentId === agentId);
      const adapter = agent ? this.services.adapterForAgent(agent) : undefined;
      let identity: HiveSessionIdentityDto;
      if (adapter) {
        identity = await this.services.resolveIdentity(adapter, savedSession);
      } else {
        const hiveSessionId = agent?.callerAgentId ?? savedSession.callerAgentId ?? this.services.callerAgentIds.allocate(reservedSessionIds);
        identity = {
          hiveSessionId,
          sessionName: savedSession.sessionName?.trim() || agent?.sessionName?.trim() || defaultHiveSessionName(hiveSessionId),
        };
      }

      let callerAgentId = identity.hiveSessionId;
      if (!callerAgentId || usedCallerAgentIds.has(callerAgentId) ||
          snapshot.agents.some((candidate) => candidate.agentId === callerAgentId)) {
        callerAgentId = this.services.callerAgentIds.allocate(reservedSessionIds);
        identity = { hiveSessionId: callerAgentId, sessionName: defaultHiveSessionName(callerAgentId) };
      }
      if (agent?.callerAgentId !== callerAgentId || savedSession.callerAgentId !== callerAgentId ||
          agent?.sessionName !== identity.sessionName || savedSession.sessionName !== identity.sessionName) updated = true;
      usedCallerAgentIds.add(callerAgentId);
      reservedSessionIds.add(callerAgentId);
      const restoredSession = { ...savedSession, callerAgentId, sessionName: identity.sessionName };
      const restoredAgent = agent ? { ...copyAgent(agent), callerAgentId, sessionName: identity.sessionName } : undefined;
      this.services.storeRestoredSession(agentId, restoredSession, restoredAgent);
    }

    return updated;
  }
}
