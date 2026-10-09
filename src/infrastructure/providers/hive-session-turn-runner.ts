import type { AssistantEvent, AssistantEventPublisher } from "../../application/ports/events.js";
import type { AgentExecutionContext } from "../../application/ports/a2a-agent-adapter.js";
import type { ProviderConversationPort } from "../../application/ports/provider-conversations.js";
import type { ProviderSessionPort } from "../../application/ports/provider-sessions.js";
import type { ProviderSettingsPort } from "../../application/ports/provider-settings.js";
import type { ProviderPromptInput, ProviderTurnsPort } from "../../application/ports/provider-turns.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { A2ATaskDto as AgentTask, A2ATaskResultDto as AgentResult } from "../../application/dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import {
  decodeHiveSessionAddressForProvider,
  type HiveSessionAddress,
} from "./hive-session-agent-address.js";
import { HiveSessionTurnRegistry, type ActiveTask, type TurnCompletion } from "./hive-session-turn-registry.js";
import { HiveSessionTaskTurnEvents } from "./hive-session-turn-events.js";
import { HiveSessionTaskThreadLifecycle, type HiveSessionTaskThread } from "./hive-session-task-thread-lifecycle.js";
import { HiveSessionTaskCommunicationPublisher } from "./hive-session-task-communication-publisher.js";
import { hiveSessionProviderFault } from "./hive-session-agent-error.js";
import { mapHiveSessionTurnCompletion } from "./hive-session-turn-result-mapper.js";

type HiveSessionTurnRunnerOptions<Provider extends AssistantProvider> = {
  provider: Provider;
  conversations: Pick<Record<Provider, ProviderConversationPort>, Provider>[Provider];
  sessions: Pick<Record<Provider, ProviderSessionPort>, Provider>[Provider];
  settings?: Pick<Record<Provider, ProviderSettingsPort>, Provider>[Provider];
  turns: Pick<Record<Provider, ProviderTurnsPort>, Provider>[Provider];
  subscribe(handler: (event: AssistantEvent) => void): () => void;
  publishEvent(event: AssistantEvent): void;
  isPermissionProfileSupported?: (profile: string) => boolean;
};

/** Runs each A2A task in a temporary provider thread and owns its cancellation and cleanup. */
export class HiveSessionTurnRunner<Provider extends AssistantProvider> {
  private readonly registry: HiveSessionTurnRegistry;
  private readonly taskTurnEvents: HiveSessionTaskTurnEvents;
  private readonly taskThreadLifecycle: HiveSessionTaskThreadLifecycle<Provider>;
  private readonly communicationPublisher: HiveSessionTaskCommunicationPublisher;

  constructor(private readonly options: HiveSessionTurnRunnerOptions<Provider>) {
    this.registry = new HiveSessionTurnRegistry(options.provider);
    this.taskTurnEvents = new HiveSessionTaskTurnEvents(options.provider, options.subscribe);
    this.communicationPublisher = new HiveSessionTaskCommunicationPublisher(options.provider, options.publishEvent);
    this.taskThreadLifecycle = new HiveSessionTaskThreadLifecycle({
      provider: options.provider,
      conversations: options.conversations,
      sessions: options.sessions,
      registry: this.registry,
      ...(options.settings ? { settings: options.settings } : {}),
      ...(options.isPermissionProfileSupported ? { isPermissionProfileSupported: options.isPermissionProfileSupported } : {}),
    });
  }

  isTemporarySession(address: HiveSessionAddress): boolean {
    return this.registry.isTemporarySession(address);
  }

  matchesNativeSession(session: NativeSession, nativeSessionId: string): boolean {
    return this.registry.matchesNativeSession(session, nativeSessionId);
  }

  getActiveTaskIdForSession(session: NativeSession, nativeSessionId: string): string | undefined {
    return this.registry.getActiveTaskIdForSession(session, nativeSessionId);
  }

  getActiveTaskAddress(session: NativeSession, taskId: string): HiveSessionAddress | undefined {
    return this.registry.getActiveTaskAddress(session, taskId);
  }

  isBusy(address: HiveSessionAddress): boolean {
    return this.registry.isBusy(address);
  }

  onNativeSessionDeleted(address: HiveSessionAddress): void {
    this.registry.onNativeSessionDeleted(address);
  }

  async run(
    session: NativeSession,
    address: HiveSessionAddress,
    task: AgentTask,
    context: AgentExecutionContext,
    prompt: ProviderPromptInput,
  ): Promise<Pick<AgentResult, "status" | "message">> {
    const active = this.registry.registerTask(task.taskId, address);
    let unsubscribe: (() => void) | undefined;
    let accepted = false;
    let executionAddress: HiveSessionAddress | undefined;
    let taskThread: HiveSessionTaskThread | undefined;
    let providerStage = "opening the registered session";
    try {
      providerStage = "opening the registered session";
      const current = await this.taskThreadLifecycle.openRegisteredThread(address);
      throwIfCancelled(context.signal);
      const workspace = this.taskThreadLifecycle.resolveWorkspace(session, current);
      providerStage = "creating an ephemeral task session";
      taskThread = await this.taskThreadLifecycle.createTaskThread(session, address, current, workspace);
      executionAddress = taskThread.address;
      active.address = executionAddress;
      throwIfCancelled(context.signal);
      providerStage = "copying the registered session settings";
      await this.taskThreadLifecycle.copySettings(session, taskThread, context.inheritedPermissions);
      throwIfCancelled(context.signal);
      providerStage = "preparing the provider prompt";
      await this.options.turns.assertPromptReady(executionAddress.target, executionAddress.threadId);

      const taskAddress = executionAddress;
      unsubscribe = this.taskTurnEvents.observe(taskAddress, active);

      providerStage = "submitting the provider prompt";
      const sent = await this.options.turns.sendPrompt(taskAddress.target, taskAddress.threadId, { ...prompt, cwd: workspace });
      if (!sent.accepted) throw hiveSessionProviderFault("PROCESS_EXITED", "Provider did not accept the A2A task");
      accepted = true;
      this.taskTurnEvents.markAccepted(active, sent.turnId);
      if (active.cancelRequested || context.signal.aborted) {
        if (active.turnId) await this.options.turns.interruptTurn(taskAddress.target, taskAddress.threadId, active.turnId);
        active.nativeFinished = true;
        throw new Error("A2A task was cancelled before the provider accepted its turn");
      }

      const hasRequestSummary = this.communicationPublisher.publishRequest(address, task, prompt.a2aCommunications);

      let completion: TurnCompletion;
      try {
        providerStage = "waiting for the provider turn";
        completion = await this.taskTurnEvents.waitForCompletion(active, context.signal);
      } catch (error) {
        if (context.signal.aborted) await active.cancellationPromise;
        throw error;
      }
      active.nativeFinished = true;
      const result = mapHiveSessionTurnCompletion(completion, active.messages);
      this.communicationPublisher.publishResult(address, task, context, result.output, hasRequestSummary);
      return {
        status: result.status,
        message: result.message,
      };
    } catch (error) {
      if (hasProviderFault(error)) throw error;
      throw hiveSessionProviderFault(
        "PROVIDER_UNAVAILABLE",
        `${this.options.provider} A2A provider failed while ${providerStage}.`,
      );
    } finally {
      unsubscribe?.();
      if (!accepted) active.nativeFinished = true;
      if (taskThread) {
        await this.taskThreadLifecycle.cleanupTaskThread(address, taskThread);
      }
      this.registry.removeTask(task.taskId);
    }
  }

  async cancel(session: NativeSession, taskId: string): Promise<void> {
    const active = this.registry.getTask(taskId);
    if (!active) return;
    const address = decodeHiveSessionAddressForProvider(session, this.options.provider);
    if (!address || address.target !== active.ownerAddress.target || address.threadId !== active.ownerAddress.threadId) {
      throw hiveSessionProviderFault("SESSION_NOT_FOUND", "The active A2A task session does not match the cancellation request");
    }
    active.cancelRequested = true;
    try {
      if (active.accepted && !active.turnId) {
        throw hiveSessionProviderFault("CANCEL_UNSUPPORTED", "The provider did not expose a turn ID for cancellation");
      }
      if (active.turnId && active.address) {
        await this.options.turns.interruptTurn(active.address.target, active.address.threadId, active.turnId);
        active.nativeFinished = true;
      }
    } finally {
      active.resolveCancellation();
    }
  }

}

function hasProviderFault(error: unknown): error is Error & { code: string; provider: string } {
  return typeof error === "object" && error !== null && "code" in error && "provider" in error &&
    typeof error.code === "string" && typeof error.provider === "string";
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("A2A task was cancelled");
}
