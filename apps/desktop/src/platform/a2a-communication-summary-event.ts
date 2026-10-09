import type { A2ACommunicationSummaryItem } from "../../../../src/domain/a2a-communication.js";
import type { UiBridgeEvent } from "../../../../src/presentation/shared/bridge-events";
import { asRecord, stringValue } from "./bridge-event-values.js";

type A2ACommunicationSummaryEventPayload = Pick<
  Extract<UiBridgeEvent, { type: "a2aCommunicationSummary" }>,
  "type" | "summaryId" | "communications" | "responseTurnId"
>;

/** Validate and map the established A2A summary payload into its presentation event fields. */
export function mapA2ACommunicationSummaryEvent(
  params: Record<string, unknown>,
): A2ACommunicationSummaryEventPayload | undefined {
  const summaryId = stringValue(params.summaryId);
  const communications = communicationSummaryItems(params.communications);
  if (!summaryId || !communications) return undefined;
  const responseTurnId = stringValue(params.responseTurnId);
  return {
    type: "a2aCommunicationSummary",
    summaryId,
    communications,
    ...(responseTurnId ? { responseTurnId } : {}),
  };
}

function communicationSummaryItems(value: unknown): A2ACommunicationSummaryItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const communications: A2ACommunicationSummaryItem[] = [];
  for (const itemValue of value) {
    const item = asRecord(itemValue);
    const kind = item?.kind;
    const taskId = stringValue(item?.taskId);
    const sourceAgentId = stringValue(item?.sourceAgentId);
    const message = typeof item?.message === "string" ? item.message : undefined;
    const sourceSessionName = stringValue(item?.sourceSessionName);
    const createdAt = item?.createdAt;
    if ((kind !== "request" && kind !== "result") || !taskId || !sourceAgentId || message === undefined ||
        (createdAt !== undefined && (typeof createdAt !== "number" || !Number.isFinite(createdAt)))) return undefined;
    communications.push({
      kind,
      taskId,
      sourceAgentId,
      ...(sourceSessionName ? { sourceSessionName } : {}),
      ...(typeof createdAt === "number" ? { createdAt } : {}),
      message,
    });
  }
  return communications;
}
