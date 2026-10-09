import type { AssistantThreadDto } from "../../../../src/application/dto/assistant.js";
import type { BridgeEvent } from "../../../../src/application/dto/daemon/daemon-events.js";

/** Replace one provider's catalog while preserving the other providers' threads. */
export function replaceProviderThreads(
  current: AssistantThreadDto[],
  provider: unknown,
  replacement: AssistantThreadDto[],
): AssistantThreadDto[] {
  return [...current.filter((thread) => thread.provider !== provider), ...replacement];
}

/** Apply thread lifecycle events to one daemon's catalog snapshot. */
export function applyThreadCatalogEvent(
  current: AssistantThreadDto[],
  event: BridgeEvent,
): AssistantThreadDto[] | undefined {
  const provider = event.provider;
  if (!provider) return undefined;

  const matches = (thread: AssistantThreadDto) => thread.provider === provider && thread.id === event.threadId;
  if (event.method === "thread/deleted") return current.filter((thread) => !matches(thread));

  if (event.method === "thread/name/updated" && typeof event.params.name === "string") {
    const title = event.params.name;
    return current.map((thread) => matches(thread) ? { ...thread, title } : thread);
  }

  if (event.method === "thread/created" && typeof event.params.name === "string" && typeof event.params.cwd === "string") {
    const thread: AssistantThreadDto = {
      id: event.threadId,
      provider,
      title: event.params.name,
      cwd: event.params.cwd,
      preview: typeof event.params.preview === "string" ? event.params.preview : "",
      updatedAt: typeof event.params.updatedAt === "string" || typeof event.params.updatedAt === "number" ? event.params.updatedAt : null,
      ...(typeof event.params.hiveSessionId === "string" ? { hiveSessionId: event.params.hiveSessionId } : {}),
    };
    return [...current.filter((item) => !matches(item)), thread];
  }

  return undefined;
}
