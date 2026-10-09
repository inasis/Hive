import type { A2ACommunicationSummaryItemDto } from "../dto/a2a-communication.js";
import type { A2ATaskRecordDto } from "../dto/a2a-collaboration.js";
import { a2aCommunicationGroupKey } from "../mappers/a2a-communication-mapper.js";
import { isAssistantProvider } from "../../domain/provider-catalog.js";
import type { AssistantEventPublisher } from "../ports/events.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import { isTerminalTask } from "../validation/a2a-runtime-copy.js";

type A2ATaskResultPublisherDependencies = {
  directory: Pick<A2ARuntimeDirectoryPort, "getAgentNode" | "getSession" | "getAdapter">;
  getTaskGraph(rootTaskId: string): Iterable<A2ATaskRecordDto>;
  publishAssistantEvent?: AssistantEventPublisher;
};

/** Converts completed A2A tasks into assistant transcript summary events. */
export class A2ATaskResultPublisher {
  private readonly publishedSummaryKeys = new Set<string>();

  constructor(private readonly dependencies: A2ATaskResultPublisherDependencies) {}

  publishForTerminalTask(record: A2ATaskRecordDto): void {
    const delivery = record.task.metadata?.delivery;
    if ((delivery !== "a2a-async-request" && delivery !== "a2a-result-delivery" && delivery !== "a2a-result-callback" &&
        delivery !== "a2b-bonded-request") || record.task.sourceAgent === "orchestrator") return;

    const { directory } = this.dependencies;
    const caller = directory.getAgentNode(record.task.sourceAgent);
    const callerSession = caller ? directory.getSession(caller.agentId) : undefined;
    const callerAdapter = caller ? directory.getAdapter(caller.adapterId) : undefined;
    const address = callerSession ? callerAdapter?.getPromptAddress?.(callerSession) : undefined;
    const provider = caller && isAssistantProvider(caller.provider) ? caller.provider : undefined;
    if (!caller || !address || !provider) return;

    const records = record.task.parentTaskId
      ? [record]
      : [...this.dependencies.getTaskGraph(record.task.rootTaskId)]
        .filter((candidate) => isTerminalTask(candidate.state))
        .sort((left, right) => left.task.createdAt - right.task.createdAt || left.task.taskId.localeCompare(right.task.taskId));
    const communications = records.flatMap((candidate): A2ACommunicationSummaryItemDto[] => {
      const source = directory.getAgentNode(candidate.task.sourceAgent);
      const responder = directory.getAgentNode(candidate.task.targetAgent);
      return [
        ...(source ? [{
          kind: "request" as const,
          taskId: candidate.task.taskId,
          sourceAgentId: source.agentId,
          ...(source.sessionName ? { sourceSessionName: source.sessionName } : {}),
          createdAt: candidate.task.createdAt,
          message: candidate.task.message,
        }] : []),
        {
          kind: "result" as const,
          taskId: candidate.task.taskId,
          sourceAgentId: candidate.task.targetAgent,
          ...(responder?.sessionName ? { sourceSessionName: responder.sessionName } : {}),
          createdAt: candidate.task.createdAt,
          message: candidate.result?.message ?? candidate.error?.message ?? `Task ${candidate.state.toLowerCase()}.`,
        },
      ];
    });
    const summaryId = a2aCommunicationGroupKey(communications);
    const publicationKey = `${caller.agentId}\u0000${summaryId}`;
    if (!communications.length || this.publishedSummaryKeys.has(publicationKey)) return;
    this.publishedSummaryKeys.add(publicationKey);
    try {
      this.dependencies.publishAssistantEvent?.({
        type: "a2aCommunicationSummary",
        target: address.target,
        threadId: address.threadId,
        provider,
        summaryId,
        communications,
      });
    } catch {
      // A transcript summary is a notification and must not change task completion.
    }
  }
}
