import type {
  A2AAgentPermissionProfileDto,
  A2ATaskDto,
  AgentNode,
  NativeSession,
} from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import type { A2ARuntimeDirectoryPort, A2ANativeSessionProvisioningDirectoryPort } from "../ports/a2a-runtime-directory.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { validateNativeSession } from "../validation/a2a-agent-validation.js";

type ProvisioningDirectory = Pick<A2ARuntimeDirectoryPort, "requireAdapter"> & A2ANativeSessionProvisioningDirectoryPort;

type ProvisioningRequest = {
  source: AgentNode;
  sourceSession: NativeSession;
  sourceTask?: A2ATaskDto;
  roomId: string;
  targetKey: string;
  targetSessionName?: string;
};

type ProvisioningDependencies = {
  directory: ProvisioningDirectory;
  createAgentId(): string;
};

/** Creates a user-accessible A2A session when routing finds no registered target. */
export class A2ANativeSessionProvisioner {
  private readonly creations = new Map<string, Promise<AgentNode>>();

  constructor(private readonly dependencies: ProvisioningDependencies) {}

  async provision(request: ProvisioningRequest): Promise<AgentNode> {
    const { source, sourceSession, roomId } = request;
    const adapter = this.dependencies.directory.requireAdapter(source.adapterId);
    if (!sourceSession.workspace?.trim()) {
      throw runtimeFault("WORKSPACE_NOT_FOUND", source.provider, "The calling session has no workspace for a new A2A session");
    }
    if (!adapter.createSession) {
      throw runtimeFault("SESSION_CREATE_UNSUPPORTED", source.provider, "This provider adapter cannot create a user-accessible A2A session");
    }

    let inheritedPermissions: A2AAgentPermissionProfileDto | undefined;
    if (adapter.permissionHandling !== "preserve-target") {
      if (!adapter.getPermissionProfile) {
        throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent does not expose an inheritable permission profile");
      }
      inheritedPermissions = await adapter.getPermissionProfile(sourceSession, request.sourceTask);
      if (!inheritedPermissions || inheritedPermissions.provider !== source.provider) {
        throw runtimeFault("PERMISSION_DENIED", source.provider, "The calling agent's effective permissions could not be determined");
      }
    }

    const creationKey = `${roomId}\u0000${source.agentId}\u0000${source.adapterId}\u0000${sourceSession.workspace}\u0000${request.targetKey}`;
    let creation = this.creations.get(creationKey);
    if (!creation) {
      creation = this.createSession(source, sourceSession, roomId, adapter, {
        ...(request.targetSessionName ? { sessionName: request.targetSessionName.trim() } : {}),
        ...(inheritedPermissions ? { inheritedPermissions } : {}),
      });
      this.creations.set(creationKey, creation);
    }
    try {
      return await creation;
    } finally {
      if (this.creations.get(creationKey) === creation) this.creations.delete(creationKey);
    }
  }

  private async createSession(
    source: AgentNode,
    sourceSession: NativeSession,
    roomId: string,
    adapter: AgentAdapter,
    input: { sessionName?: string; inheritedPermissions?: A2AAgentPermissionProfileDto },
  ): Promise<AgentNode> {
    const session = await adapter.createSession!(sourceSession, input);
    validateNativeSession(session);
    if (session.provider !== source.provider || session.workspace !== sourceSession.workspace) {
      throw runtimeFault("INVALID_REQUEST", source.provider, "The new A2A session did not retain the caller's provider workspace");
    }
    const agentId = this.dependencies.createAgentId();
    if (typeof agentId !== "string" || !agentId.trim() || this.dependencies.directory.hasAgent(agentId)) {
      throw runtimeFault("INVALID_REQUEST", source.provider, "Could not allocate an agent ID for the new session");
    }
    return this.dependencies.directory.registerAgent(roomId, {
      agentId,
      adapterId: adapter.adapterId,
      session: {
        ...session,
        ...(input.sessionName ? { sessionName: input.sessionName } : {}),
      },
    });
  }
}
