import type { AssistantEvent } from "../../application/ports/events.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import { decodeHiveSessionAddressForProvider, encodeHiveSessionAddressKey, type HiveSessionAddress } from "./hive-session-agent-address.js";

export type TurnCompletion = Extract<AssistantEvent, { type: "turnCompleted" }>;

export type ActiveTask = {
  ownerAddress: HiveSessionAddress;
  address?: HiveSessionAddress;
  turnId?: string;
  messages: Map<string, string>;
  accepted: boolean;
  cancelRequested: boolean;
  completion?: TurnCompletion;
  completionPromise: Promise<TurnCompletion>;
  resolveCompletion(value: TurnCompletion): void;
  cancellationPromise: Promise<void>;
  resolveCancellation(): void;
  nativeFinished: boolean;
};

/** Owns active A2A task and ephemeral-thread bookkeeping for provider sessions. */
export class HiveSessionTurnRegistry {
  private readonly activeTasks = new Map<string, ActiveTask>();
  private readonly ephemeralSessionIds = new Set<string>();

  constructor(private readonly provider: AssistantProvider) {}

  registerTask(taskId: string, ownerAddress: HiveSessionAddress): ActiveTask {
    if (this.activeTasks.has(taskId)) throw new Error("A2A task ID is already active in this provider adapter");
    const active = createActiveTask(ownerAddress);
    this.activeTasks.set(taskId, active);
    return active;
  }

  getTask(taskId: string): ActiveTask | undefined {
    return this.activeTasks.get(taskId);
  }

  removeTask(taskId: string): void {
    this.activeTasks.delete(taskId);
  }

  markTemporary(address: HiveSessionAddress): void {
    this.ephemeralSessionIds.add(encodeHiveSessionAddressKey(address));
  }

  forgetTemporary(address: HiveSessionAddress): void {
    this.ephemeralSessionIds.delete(encodeHiveSessionAddressKey(address));
  }

  isTemporarySession(address: HiveSessionAddress): boolean {
    return this.ephemeralSessionIds.has(encodeHiveSessionAddressKey(address));
  }

  matchesNativeSession(session: NativeSession, nativeSessionId: string): boolean {
    const ownerAddress = decodeHiveSessionAddressForProvider(session, this.provider);
    if (!ownerAddress) return false;
    return ownerAddress.threadId === nativeSessionId || [...this.activeTasks.values()].some((active) =>
      active.ownerAddress.target === ownerAddress.target && active.address?.threadId === nativeSessionId,
    );
  }

  getActiveTaskIdForSession(session: NativeSession, nativeSessionId: string): string | undefined {
    const ownerAddress = decodeHiveSessionAddressForProvider(session, this.provider);
    if (!ownerAddress) return undefined;
    for (const [taskId, active] of this.activeTasks) {
      if (active.ownerAddress.target === ownerAddress.target && active.ownerAddress.threadId === ownerAddress.threadId &&
          active.address?.threadId === nativeSessionId) return taskId;
    }
    return undefined;
  }

  getActiveTaskAddress(session: NativeSession, taskId: string): HiveSessionAddress | undefined {
    const ownerAddress = decodeHiveSessionAddressForProvider(session, this.provider);
    const active = this.activeTasks.get(taskId);
    if (!ownerAddress || !active || !sameAddress(active.ownerAddress, ownerAddress)) return undefined;
    return active.address;
  }

  isBusy(address: HiveSessionAddress): boolean {
    return [...this.activeTasks.values()].some((active) => sameAddress(active.ownerAddress, address));
  }

  onNativeSessionDeleted(address: HiveSessionAddress): void {
    this.ephemeralSessionIds.delete(encodeHiveSessionAddressKey(address));
  }
}

function createActiveTask(ownerAddress: HiveSessionAddress): ActiveTask {
  let resolveCompletion!: (value: TurnCompletion) => void;
  const completionPromise = new Promise<TurnCompletion>((resolve) => { resolveCompletion = resolve; });
  let resolveCancellation!: () => void;
  const cancellationPromise = new Promise<void>((resolve) => { resolveCancellation = resolve; });
  return {
    ownerAddress,
    messages: new Map(),
    accepted: false,
    cancelRequested: false,
    completionPromise,
    resolveCompletion,
    cancellationPromise,
    resolveCancellation,
    nativeFinished: false,
  };
}

function sameAddress(left: HiveSessionAddress, right: HiveSessionAddress): boolean {
  return left.target === right.target && left.threadId === right.threadId;
}
