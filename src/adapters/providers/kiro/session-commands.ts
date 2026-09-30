import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderSkillsPort, ProviderSkillCatalog } from "../../../application/ports/provider-skills.js";
import type { ProviderCommandsPort, ProviderCommandCatalog, ProviderCommandResult } from "../../../application/ports/provider-commands.js";
import { listKiroSessions } from "./cli.js";
import type { KiroRemoteSession } from "./session-context.js";
import { kiroCommandArguments, listKiroCommands } from "./session-command-mapper.js";
import { kiroEffortOptions, loadKiroSkills, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { publishKiroEvent } from "./session-events.js";
import { asObject, firstString } from "./session-utils.js";
import type { KiroRequireOpenThread } from "./thread-access.js";

type RewindConversation = (
  session: KiroRemoteSession,
  target: string,
  threadId: string,
  turnId: string | undefined,
  title: string,
) => Promise<{ threadId: string; title: string; cwd: string }>;

/** Implements Kiro skills and slash command behavior. */
export class KiroSessionCommandAdapter implements ProviderSkillsPort, ProviderCommandsPort {
  constructor(
    private readonly requireOpenThread: KiroRequireOpenThread,
    private readonly rewindConversation: RewindConversation,
    private readonly publish: AssistantEventPublisher,
  ) {}

  async listSkills(target: string, threadId: string, cwd?: string): Promise<ProviderSkillCatalog> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before listing its skills");
    const directory = firstString(cwd, session.cwdByThread.get(threadId)) ?? "";
    return { skills: await loadKiroSkills(session, target, threadId, directory), warnings: [] };
  }

  async listCommands(target: string, threadId: string): Promise<ProviderCommandCatalog> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before listing its commands");
    return { commands: listKiroCommands(session, threadId), warnings: [] };
  }

  async runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before running its commands");
    const available = listKiroCommands(session, threadId);
    if (!available.some((candidate) => candidate.name === command)) {
      throw new Error(`Kiro에서 /${command} 명령을 찾지 못했습니다. / 메뉴를 새로고침하고 다시 선택하세요.`);
    }
    if (command === "rewind") {
      const requestedIndex = Number(argumentsText.trim());
      const userEntries = (session.transcriptsByThread.get(threadId) ?? []).filter((entry) => entry.role === "user");
      if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > userEntries.length) {
        throw new Error(`/rewind에는 1부터 ${userEntries.length} 사이의 최근 프롬프트 번호를 입력하세요.`);
      }
      const selected = userEntries.at(-requestedIndex);
      const parentTitle = (await listKiroSessions(target)).find((item) => item.id === threadId)?.title ?? "대화";
      const forked = await this.rewindConversation(session, target, threadId, selected?.turnId, `${parentTitle} · 되감기`);
      return {
        executed: true,
        message: "선택한 대화 시점에서 새 Kiro 세션을 만들었습니다.",
        thread: { id: forked.threadId, title: forked.title, cwd: forked.cwd, preview: "", updatedAt: Date.now(), provider: "kiro" },
      };
    }
    const args = kiroCommandArguments(command, argumentsText);
    const result = await session.connection.executeCommand(threadId, command, args);
    if (result.success === false) throw new Error(firstString(result.message) ?? `Kiro /${command} 명령을 실행하지 못했습니다.`);
    const data = asObject(result.data);
    if (command === "clear") {
      session.transcriptsByThread.set(threadId, []);
      publishKiroEvent(this.publish, target, threadId, { type: "transcriptCleared" });
    }
    const model = firstString(asObject(data?.model)?.id, asObject(data?.model)?.modelId, data?.modelId);
    if (model) {
      const current = session.settingsByThread.get(threadId);
      session.settingsByThread.set(threadId, { model, effort: current?.effort ?? null });
      const effortOptions = await kiroEffortOptions(session, threadId);
      session.models = withKiroEffortOptions(session.models, model, effortOptions.options);
    }
    const effort = firstString(data?.effort, asObject(data?.effort)?.value);
    if (effort) {
      const current = session.settingsByThread.get(threadId);
      session.settingsByThread.set(threadId, { model: current?.model ?? "", effort });
    }
    const modeId = firstString(data?.currentModeId, data?.modeId, asObject(data?.mode)?.id);
    if (modeId) {
      session.currentModeByThread.set(threadId, modeId);
      publishKiroEvent(this.publish, target, threadId, { type: "threadSettingsUpdated", settings: { currentModeId: modeId } });
    }
    if (model || effort) {
      const current = session.settingsByThread.get(threadId);
      const modelEfforts = current ? session.models.find((candidate) => candidate.model === current.model)?.supportedReasoningEfforts : undefined;
      publishKiroEvent(this.publish, target, threadId, {
        type: "threadSettingsUpdated",
        settings: { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(modelEfforts ? { supportedReasoningEfforts: modelEfforts } : {}) },
      });
      if (current) session.settingsByThread.set(threadId, current);
    }
    const message = firstString(result.message);
    return { executed: true, ...(message ? { message } : {}) };
  }
}
