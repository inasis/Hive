import type { AdapterErrorCode } from "../../domain/a2a-adapter.js";
import type {
  A2AAgentAdapterDescriptorDto,
  A2AAgentHistoryEntryDto,
  A2AAgentInputDto,
  A2AAgentPermissionProfileDto,
  A2AAgentSessionToolRequestDto,
  A2ATaskDto,
  A2ATaskRecordDto,
  A2ATaskResultDto,
  AgentSummary,
  NativeSession,
} from "../dto/a2a-collaboration.js";
import type { HiveSessionIdentityDto } from "../dto/session-identity.js";

export type AgentAdapterDescriptor = A2AAgentAdapterDescriptorDto;

export type AgentExecutionContext = {
  signal: AbortSignal;
  history: A2AAgentHistoryEntryDto[];
  /** The registered source and target only; query the room explicitly when routing needs more agents. */
  agents: AgentSummary[];
  /** Permissions of the agent that requested this task, when the adapter can identify them. */
  inheritedPermissions?: A2AAgentPermissionProfileDto;
  /** Queue a child request and resolve once accepted; the current task never waits for its result. */
  delegate(input: A2AAgentSessionToolRequestDto): Promise<A2ATaskRecordDto>;
};

export type AgentPromptAddress = { target: string; threadId: string };

/** Provider-facing session and turn operations used by A2A application use cases. */
export interface AgentAdapter extends A2AAgentAdapterDescriptorDto {
  /** Preserve the target session's own permission configuration instead of inheriting caller permissions. */
  readonly permissionHandling?: "inherit-caller" | "preserve-target";

  discoverSessions(): Promise<NativeSession[]>;

  /** Resolve the daemon-wide identity shared with the provider session catalog, when supported. */
  ensureSessionIdentity?(session: NativeSession): Promise<string>;
  /** Resolve the daemon-owned UUID and name together when the adapter shares the daemon identity store. */
  ensureSessionMetadata?(session: NativeSession): Promise<HiveSessionIdentityDto>;

  /** Create a persistent provider session beside the caller when a named/ID target is missing. */
  createSession?(source: NativeSession, input: {
    sessionName?: string;
    inheritedPermissions?: A2AAgentPermissionProfileDto;
  }): Promise<NativeSession>;

  getDiscoveryFailures?(): AdapterErrorCode[];

  isAvailable(session: NativeSession): Promise<boolean>;

  /** Match a provider-visible session ID to the adapter-owned native session handle. */
  matchesNativeSession?(session: NativeSession, nativeSessionId: string): boolean;

  /** Match the persistent native session identity, excluding any temporary task thread. */
  matchesNativeSessionOwner?(session: NativeSession, nativeSessionId: string): boolean;

  /** Clear adapter-local availability shortcuts after the registered session is deleted. */
  onNativeSessionDeleted?(session: NativeSession): void;

  /** Match a provider target when the native tool call does not include a session ID. */
  matchesNativeTarget?(session: NativeSession, target: string): boolean;

  /** Provider address used by Hive to resume a native session with hidden queued A2A context. */
  getPromptAddress?(session: NativeSession): AgentPromptAddress | undefined;

  /** Whether this particular native session received a callable A2A tool. */
  canDelegate?(session: NativeSession): boolean;

  /** Read the effective provider permission profile, optionally from the active task's isolated thread. */
  getPermissionProfile?(session: NativeSession, activeTask?: A2ATaskDto): Promise<A2AAgentPermissionProfileDto | undefined>;

  /** Resolve an active task from a provider-native session/thread ID when the MCP client supplies one. */
  getActiveTaskIdForSession?(session: NativeSession, nativeSessionId: string): string | undefined;

  /** Whether this adapter can apply the caller's permissions to this target session. */
  canInheritPermissionProfile?(session: NativeSession, profile: A2AAgentPermissionProfileDto): boolean;

  /** Optional observation of a native turn already in progress outside this task runtime. */
  isBusy?(session: NativeSession): Promise<boolean>;

  execute(session: NativeSession, task: A2ATaskDto, context: AgentExecutionContext): Promise<A2ATaskResultDto>;

  resume(session: NativeSession, input: A2AAgentInputDto, context: AgentExecutionContext): Promise<A2ATaskResultDto>;

  attach?(session: NativeSession, input: A2AAgentInputDto, context: AgentExecutionContext): Promise<A2ATaskResultDto>;

  cancel(session: NativeSession, taskId: string): Promise<void>;
}
