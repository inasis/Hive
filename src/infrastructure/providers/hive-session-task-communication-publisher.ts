import type { AssistantEventPublisher } from "../../application/ports/events.js";
import type { AgentExecutionContext, AgentPromptAddress } from "../../application/ports/a2a-agent-adapter.js";
import type { A2ATaskDto as AgentTask } from "../../application/dto/a2a-collaboration.js";
import type { A2ACommunicationSummaryItemDto } from "../../application/dto/a2a-communication.js";
import { a2aCommunicationGroupKey } from "../../application/mappers/a2a-communication-mapper.js";
import type { AssistantProvider } from "../../domain/provider-catalog.js";

/** Translates provider task messages and results into Hive transcript summary events. */
export class HiveSessionTaskCommunicationPublisher {
  constructor(
    private readonly provider: AssistantProvider,
    private readonly publishEvent: AssistantEventPublisher,
  ) {}

  publishRequest(
    address: AgentPromptAddress,
    task: AgentTask,
    communications: readonly A2ACommunicationSummaryItemDto[] | undefined,
  ): boolean {
    const summaryCommunications = communications?.map((communication) => ({
      ...communication,
      createdAt: task.createdAt,
      ...(communication.taskId === task.taskId ? { message: task.message } : {}),
    })) ?? [];
    if (summaryCommunications.length === 0) return false;

    this.publishEvent({
      type: "a2aCommunicationSummary",
      target: address.target,
      threadId: address.threadId,
      provider: this.provider,
      summaryId: a2aCommunicationGroupKey(summaryCommunications),
      communications: summaryCommunications,
    });
    return true;
  }

  publishResult(
    address: AgentPromptAddress,
    task: AgentTask,
    context: AgentExecutionContext,
    output: string,
    hasRequestSummary: boolean,
  ): void {
    if (!hasRequestSummary || !output) return;

    const targetAgent = context.agents.find((agent) => agent.agentId === task.targetAgent);
    const communications: A2ACommunicationSummaryItemDto[] = [{
      kind: "result",
      taskId: task.taskId,
      sourceAgentId: task.targetAgent,
      ...(targetAgent?.sessionName ? { sourceSessionName: targetAgent.sessionName } : {}),
      createdAt: task.createdAt,
      message: output,
    }];
    this.publishEvent({
      type: "a2aCommunicationSummary",
      target: address.target,
      threadId: address.threadId,
      provider: this.provider,
      summaryId: a2aCommunicationGroupKey(communications),
      communications,
    });
  }
}
