import type { A2ACommunicationSummaryItem } from "../../domain/a2a-communication.js";
import type { A2ACommunicationSummaryItemDto } from "../dto/a2a-communication.js";

/** Copies the conversation projection from its Domain type into the Application contract. */
export function toA2ACommunicationSummaryItemDto(
  item: A2ACommunicationSummaryItem,
): A2ACommunicationSummaryItemDto {
  return {
    kind: item.kind,
    taskId: item.taskId,
    sourceAgentId: item.sourceAgentId,
    ...(item.sourceSessionName !== undefined ? { sourceSessionName: item.sourceSessionName } : {}),
    ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
    message: item.message,
  };
}

/** Stable identity shared by transcript projections and provider history reconstruction. */
export function a2aCommunicationGroupKey(
  communications: readonly Pick<A2ACommunicationSummaryItemDto, "taskId">[],
): string {
  return JSON.stringify([...new Set(communications.map(({ taskId }) => taskId))].sort()) ?? "[]";
}
