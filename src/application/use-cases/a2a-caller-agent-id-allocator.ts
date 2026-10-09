import type { AgentNode, NativeSession } from "../../application/dto/a2a-collaboration.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

type A2ACallerAgentIdAllocatorDependencies = {
  agents: ReadonlyMap<string, AgentNode>;
  sessions: ReadonlyMap<string, NativeSession>;
  createId(kind: "session"): string;
};

/** Allocates Hive session UUIDs that cannot collide with registered or reserved A2A identities. */
export class A2ACallerAgentIdAllocator {
  constructor(private readonly dependencies: A2ACallerAgentIdAllocatorDependencies) {}

  allocate(reserved = new Set<string>()): string {
    const { agents, sessions } = this.dependencies;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.dependencies.createId("session").trim();
      if (!candidate || reserved.has(candidate) || agents.has(candidate) ||
          [...agents.values()].some((agent) => agent.callerAgentId === candidate) ||
          [...sessions.values()].some((session) => session.callerAgentId === candidate)) continue;
      return candidate;
    }
    throw runtimeFault("INVALID_REQUEST", "", "Could not allocate a unique Hive session UUID");
  }
}
