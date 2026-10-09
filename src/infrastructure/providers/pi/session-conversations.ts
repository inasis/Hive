import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ProviderConversationPort,
  ProviderCreateThreadInput,
  ProviderCreateThreadResult,
  ProviderOpenThreadOptions,
  ProviderOpenThreadResult,
} from "../../../application/ports/provider-conversations.js";
import type { AssistantSkill } from "../../../domain/assistant.js";
import { PiSessionContext } from "./session-context.js";
import { mapPiTranscript } from "./session-transcript.js";
import { asObject } from "./session-json-values.js";
import { listPiSkills, mapPiSkills } from "./session-skills.js";
import type { PiEventRecordHandler } from "./session-types.js";

/** Owns Pi conversation creation and provider thread hydration. */
export class PiSessionConversationAdapter implements ProviderConversationPort {
  constructor(
    private readonly context: PiSessionContext,
    private readonly onRecord: PiEventRecordHandler,
  ) {}

  async createThread(target: string, input: ProviderCreateThreadInput): Promise<ProviderCreateThreadResult> {
    if (input.ephemeral) throw new Error("Pi sessions are persistent and do not support ephemeral threads.");
    const cwd = await realDirectory(input.cwd);
    const state = await this.context.getOrConnect(target);
    const model = input.model?.trim() || this.context.defaultModel(target);
    if (!model || !state.models.some((candidate) => candidate.model === model && !candidate.hidden)) {
      throw new Error("먼저 사용할 Pi 모델을 선택하세요.");
    }
    let createdThreadId = "";
    const session = await this.context.startNew(
      target,
      cwd,
      model,
      input.name,
      (record) => this.onRecord(target, () => createdThreadId, record),
      input.a2aCallerAgentId,
    );
    createdThreadId = session.thread.id;
    const sessionId = createdThreadId;
    const skills = input.minimal ? [] : await listPiSkills(session.client);
    return {
      thread: session.thread,
      threadId: sessionId,
      title: session.thread.title,
      cwd,
      entries: [],
      skills,
      skillWarnings: [],
      models: state.models,
      model,
      reasoningEffort: session.effort ?? null,
      permissionProfile: null,
      requiresFocusRestoreAfterDelete: false,
    };
  }

  async openThread(
    target: string,
    threadId: string,
    options: ProviderOpenThreadOptions = { includeTranscript: true },
  ): Promise<ProviderOpenThreadResult> {
    const session = await this.context.open(target, threadId, (record) => this.onRecord(target, () => threadId, record));
    const state = this.context.require(target);
    const [messages, forks, commandResponse] = options.minimal || !options.includeTranscript
      ? [undefined, undefined, undefined]
      : await Promise.all([
        session.client.request({ type: "get_messages" }),
        session.client.request({ type: "get_fork_messages" }),
        session.client.request({ type: "get_commands" }),
      ]);
    const skills: AssistantSkill[] = commandResponse ? mapPiSkills(commandResponse.commands) : [];
    const model = session.model ?? this.context.defaultModel(target) ?? "";
    return {
      target,
      threadId,
      title: session.thread.title,
      cwd: session.thread.cwd,
      entries: options.includeTranscript && messages
        ? mapPiTranscript(messages.messages, forks?.messages)
        : [],
      skills,
      skillWarnings: [],
      models: state.models,
      model,
      reasoningEffort: session.effort ?? null,
      permissionProfile: null,
    };
  }
}

async function realDirectory(path: string): Promise<string> {
  const actual = await realpath(resolve(path));
  const info = await stat(actual);
  if (!info.isDirectory()) throw new Error("Pi 작업공간은 디렉터리여야 합니다.");
  return actual;
}
