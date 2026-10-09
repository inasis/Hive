import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type {
  PromptRecoveryContextPort,
  PromptRecoveryControllerPort,
  PromptRecoveryEvent,
  PromptRecoveryEventSourcePort,
  PromptRecoveryOpenThreadRequest,
  PromptRecoveryRequestContext,
  PromptRecoveryResult,
  ProviderRestoreSignalsPort,
} from "../ports/prompt-recovery.js";

export interface PromptRecoveryGatewayPort<Request extends PromptRecoveryRequestContext> {
  sendPrompt(request: Request): Promise<PromptRecoveryResult>;
  openThread(request: PromptRecoveryOpenThreadRequest): Promise<unknown>;
}

export type SendPromptWithRecoveryDependencies<Request extends PromptRecoveryRequestContext> = {
  context: PromptRecoveryContextPort;
  gateway: PromptRecoveryGatewayPort<Request>;
  events: PromptRecoveryEventSourcePort;
  restoreSignals: ProviderRestoreSignalsPort;
};

const PROVIDER_RESTORE_TIMEOUT_MS = 90_000;

/** Retry a daemon prompt only after transport and provider-session recovery are both observed. */
export class SendPromptWithRecoveryUseCase<Request extends PromptRecoveryRequestContext>
  implements PromptRecoveryControllerPort<Request> {
  constructor(private readonly dependencies: SendPromptWithRecoveryDependencies<Request>) {}

  markProviderRestored(target: string, provider: AssistantProvider): void {
    this.dependencies.restoreSignals.markRestored(target, provider);
  }

  markProviderRestoreFailed(target: string, provider: AssistantProvider, message: string): void {
    this.dependencies.restoreSignals.markFailed(target, provider, message);
  }

  async submit(request: Request): Promise<PromptRecoveryResult> {
    if (!this.dependencies.context.isDaemonClient()) return this.dependencies.gateway.sendPrompt(request);

    const provider = request.provider ?? this.dependencies.context.getActiveProvider();
    const restoreVersion = this.dependencies.restoreSignals.currentVersion(request.target, provider);
    let disconnected = false;
    let turnStarted = false;
    let transportFailure: string | undefined;
    const unsubscribe = this.dependencies.events.subscribe((event) => {
      if (event.target !== request.target) return;
      if (event.type === "transportDisconnected") disconnected = true;
      else if (event.type === "transportFailed") transportFailure = event.message ?? "Hive 데몬에 다시 연결하지 못했습니다.";
      else if (isMatchingTurnStarted(event, request, provider)) turnStarted = true;
    });

    try {
      try {
        return await this.dependencies.gateway.sendPrompt(request);
      } catch (error) {
        if (!disconnected) throw error;
        if (turnStarted) return { accepted: true };
        if (transportFailure) throw new Error(transportFailure);
        await this.dependencies.restoreSignals.waitForRestore(
          request.target,
          provider,
          restoreVersion,
          PROVIDER_RESTORE_TIMEOUT_MS,
        );
        if (transportFailure) throw new Error(transportFailure);
        await this.dependencies.gateway.openThread({
          target: request.target,
          threadId: request.threadId,
          provider,
          includeTranscript: false,
        });
        return await this.dependencies.gateway.sendPrompt(request);
      }
    } finally {
      unsubscribe();
    }
  }
}

function isMatchingTurnStarted<Request extends PromptRecoveryRequestContext>(
  event: PromptRecoveryEvent,
  request: Request,
  provider: AssistantProvider,
): event is Extract<PromptRecoveryEvent, { type: "turnStarted" }> {
  return event.type === "turnStarted" && event.threadId === request.threadId &&
    (!event.provider || event.provider === provider);
}
