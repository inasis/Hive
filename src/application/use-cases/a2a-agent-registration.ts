import type { HiveSessionIdentityDto } from "../dto/session-identity.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { AgentNode, AgentRoom, NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { RegisterAgentInput } from "./a2a-runtime-types.js";
import { copyAgent, copyAgentSummary } from "../validation/a2a-runtime-copy.js";
import { sessionCapabilityError, validateNativeSession } from "../validation/a2a-agent-validation.js";
import { requireNonEmpty, uniqueStrings } from "../validation/a2a-runtime-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

type A2AAgentRegistrationServices = {
  requireRoom(roomId: string): AgentRoom;
  requireAdapter(adapterId: string): AgentAdapter;
  hasAgent(agentId: string): boolean;
  hasRegisteredNativeSession(session: NativeSession): boolean;
  hasCallerAgentId(callerAgentId: string): boolean;
  resolveSessionIdentity(adapter: AgentAdapter, session: NativeSession): Promise<HiveSessionIdentityDto>;
  register(agent: AgentNode, session: NativeSession, room: AgentRoom): void;
  readClock(): number;
  persist(): Promise<void>;
  emit(event: A2ARuntimeEvent): void;
};

/** Validates and registers one native session as an A2A agent. */
export class A2AAgentRegistration {
  constructor(private readonly services: A2AAgentRegistrationServices) {}

  async registerAgent(roomId: string, input: RegisterAgentInput): Promise<AgentNode> {
    const room = this.services.requireRoom(roomId);
    const adapter = this.services.requireAdapter(input.adapterId);
    validateNativeSession(input.session);
    if (input.session.provider !== adapter.provider) {
      throw runtimeFault("INVALID_REQUEST", adapter.provider, "Session provider does not match its adapter");
    }
    const unsupported = sessionCapabilityError(input.session, adapter);
    if (unsupported) throw runtimeFault(unsupported, adapter.provider, "Adapter does not declare the session capability required by this persistence level");
    requireNonEmpty(input.agentId, "agentId");
    if (this.services.hasAgent(input.agentId)) throw runtimeFault("INVALID_REQUEST", adapter.provider, "Agent already exists");
    if (this.services.hasRegisteredNativeSession(input.session)) {
      throw runtimeFault("INVALID_REQUEST", adapter.provider, "Native session is already registered");
    }
    const identity = await this.services.resolveSessionIdentity(adapter, input.session);
    const callerAgentId = identity.hiveSessionId;
    if (callerAgentId === input.agentId || this.services.hasAgent(callerAgentId) || this.services.hasCallerAgentId(callerAgentId)) {
      throw runtimeFault("INVALID_REQUEST", adapter.provider, "Hive session UUID is already assigned to another session");
    }
    const session = { ...input.session, callerAgentId, sessionName: identity.sessionName };

    let state: AgentNode["state"] = "IDLE";
    let offlineReason: AgentNode["offlineReason"];
    try {
      if (!(await adapter.isAvailable(input.session))) {
        state = "OFFLINE";
        offlineReason = "SESSION_UNAVAILABLE";
      }
    } catch {
      state = "OFFLINE";
      offlineReason = "ADAPTER_UNAVAILABLE";
    }

    const agent: AgentNode = {
      agentId: input.agentId,
      callerAgentId,
      provider: input.session.provider,
      adapterId: input.adapterId,
      nativeSessionId: input.session.sessionId,
      state,
      lastActivityAt: this.services.readClock(),
      capabilities: uniqueStrings(input.capabilities ?? []),
      ...(input.role ? { role: input.role } : {}),
      sessionName: identity.sessionName,
      ...(input.session.workspace ? { workspace: input.session.workspace } : {}),
      ...(offlineReason ? { offlineReason } : {}),
    };
    this.services.register(agent, session, room);
    await this.services.persist();
    this.services.emit({ type: "room.updated", room });
    this.services.emit({ type: "agent.updated", agent: copyAgentSummary(agent) });
    return copyAgent(agent);
  }
}
