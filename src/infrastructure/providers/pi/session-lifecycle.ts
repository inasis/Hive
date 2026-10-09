import { dirname, resolve } from "node:path";
import { unlink } from "node:fs/promises";
import type { ProviderSessionPort } from "../../../application/ports/provider-sessions.js";
import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import { PiSessionContext } from "./session-context.js";
import type { PiEventRecordHandler } from "./session-types.js";

/** Owns Pi session rename and deletion, including local session file cleanup. */
export class PiSessionLifecycleAdapter implements ProviderSessionPort {
  constructor(
    private readonly context: PiSessionContext,
    private readonly onRecord: PiEventRecordHandler,
    private readonly publish: AssistantEventPublisher,
  ) {}

  async renameThread(target: string, threadId: string, name: string): Promise<void> {
    const session = await this.context.open(target, threadId, (record) => this.onRecord(target, () => threadId, record));
    const trimmed = name.trim();
    if (!trimmed) throw new Error("세션 이름을 입력하세요.");
    await session.client.request({ type: "set_session_name", name: trimmed });
    session.sessionName = trimmed;
    session.thread = { ...session.thread, title: trimmed };
    this.publish({ target, threadId, provider: "pi", type: "threadRenamed", title: trimmed });
  }

  async deleteThread(target: string, threadId: string): Promise<void> {
    const state = this.context.require(target);
    const descriptor = state.threads.get(threadId);
    if (!descriptor) throw new Error("Pi 세션을 찾을 수 없습니다.");
    await state.opened.get(threadId)?.client.close();
    state.opened.delete(threadId);
    const file = resolve(descriptor.sessionFile);
    if (dirname(file) !== resolve(this.context.sessionDirectory)) throw new Error("Pi 세션 경로가 유효하지 않습니다.");
    try {
      await unlink(file);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    state.threads.delete(threadId);
    this.publish({ target, threadId, provider: "pi", type: "threadDeleted" });
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
