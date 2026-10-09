import type { ProviderForkPort, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../../../application/ports/provider-forks.js";
import { PiSessionContext } from "./session-context.js";
import { listPiSkills } from "./session-skills.js";
import type { PiEventRecordHandler } from "./session-types.js";

/** Implements Pi branch forks through the RPC fork and clone commands. */
export class PiSessionForkAdapter implements ProviderForkPort {
  constructor(private readonly context: PiSessionContext, private readonly onRecord: PiEventRecordHandler) {}

  async forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult> {
    let forkId = "";
    const fork = await this.context.duplicateForFork(target, threadId, undefined, (record) => this.onRecord(target, () => forkId, record));
    forkId = fork.thread.id;
    const state = this.context.require(target);
    return {
      target,
      threadId: forkId,
      title: fork.thread.title,
      cwd: fork.thread.cwd,
      skills: await listPiSkills(fork.client),
      skillWarnings: [],
      models: state.models,
      model: fork.model ?? "",
      reasoningEffort: fork.effort ?? null,
      permissionProfile: null,
    };
  }

  async forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    if (!input.messageId) throw new Error("Pi fork requires a user message entry ID.");
    let forkId = "";
    const fork = await this.context.duplicateForFork(target, threadId, input.messageId, (record) => this.onRecord(target, () => forkId, record));
    forkId = fork.thread.id;
    const title = input.name.trim() || fork.thread.title;
    await fork.client.request({ type: "set_session_name", name: title });
    fork.sessionName = title;
    fork.thread = { ...fork.thread, title };
    return {
      target,
      threadId: forkId,
      title,
      cwd: fork.thread.cwd,
      preview: fork.thread.preview,
      updatedAt: Date.now(),
      provider: "pi",
    };
  }
}
