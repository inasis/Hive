import type { AgentSummary } from "../../application/dto/a2a-collaboration.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";

type A2ANativeSessionAgentResolverDependencies = {
  directory: Pick<A2ARuntimeDirectoryPort, "findAgentForNativeSession" | "listRooms" | "ensureSessionsDiscovered">;
  assertInitialized(): void;
};

/** Finds a registered caller, discovering provider sessions in each room when needed. */
export class A2ANativeSessionAgentResolver {
  constructor(private readonly dependencies: A2ANativeSessionAgentResolverDependencies) {}

  async resolve(provider: string, nativeSessionId: string): Promise<AgentSummary | undefined> {
    this.dependencies.assertInitialized();
    const { directory } = this.dependencies;
    let agent = directory.findAgentForNativeSession(provider, nativeSessionId);
    if (agent) return agent;
    for (const room of directory.listRooms()) {
      await directory.ensureSessionsDiscovered(room.roomId);
      agent = directory.findAgentForNativeSession(provider, nativeSessionId);
      if (agent) return agent;
    }
    return undefined;
  }
}
