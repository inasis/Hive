import type { AgentExecutionContext } from "../../application/ports/a2a-agent-adapter.js";
import { buildA2ATaskPrompt } from "../../application/use-cases/a2a-task-prompt.js";
import type { A2ACommunicationSummaryItemDto } from "../../application/dto/a2a-communication.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { A2AAgentInputDto as AgentInput, A2ATaskResultDto as AgentResult } from "../../application/dto/a2a-collaboration.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import { hiveSessionCancelledResult, hiveSessionFailedResult } from "./hive-session-agent-error.js";
import {
  decodeHiveSessionAddressForProvider,
} from "./hive-session-agent-address.js";
import type { HiveSessionTurnRunner } from "./hive-session-turn-runner.js";

type HiveSessionTaskResumeOptions<Provider extends AssistantProvider> = {
  provider: Provider;
  turnRunner: Pick<HiveSessionTurnRunner<Provider>, "run">;
  session: NativeSession;
  input: AgentInput;
  context: AgentExecutionContext;
  canDelegate(session: NativeSession): boolean;
};

/** Builds the A2A prompt and summary, runs the provider turn, and maps cancellation/results. */
export async function resumeHiveSessionTask<Provider extends AssistantProvider>({
  provider,
  turnRunner,
  session,
  input,
  context,
  canDelegate,
}: HiveSessionTaskResumeOptions<Provider>): Promise<AgentResult> {
  const address = decodeHiveSessionAddressForProvider(session, provider);
  if (!address) {
    return hiveSessionFailedResult(input.task, "SESSION_NOT_FOUND", "The registered provider session is unavailable.");
  }
  if (context.signal.aborted) return hiveSessionCancelledResult(input.task);

  try {
    const message = buildA2ATaskPrompt({ task: input.task, message: input.message, canDelegate: canDelegate(session) });
    const sourceName = context.agents.find((agent) => agent.agentId === input.task.sourceAgent)?.sessionName;
    const communication: A2ACommunicationSummaryItemDto = {
      kind: input.task.metadata?.delivery === "a2a-result-callback" || input.task.metadata?.delivery === "a2a-result-delivery" ? "result" : "request",
      taskId: input.task.taskId,
      sourceAgentId: input.task.sourceAgent,
      ...(sourceName ? { sourceSessionName: sourceName } : {}),
      message,
    };
    const turn = await turnRunner.run(session, address, input.task, context, {
      text: "",
      a2aCommunications: [communication],
    });
    return { taskId: input.task.taskId, agentId: input.task.targetAgent, ...turn };
  } catch (error) {
    if (context.signal.aborted) return hiveSessionCancelledResult(input.task);
    throw error;
  }
}
