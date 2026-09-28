import type { ProviderForkPort, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../../../application/ports/provider-forks.js";
import { discoverCodexSkills } from "./skill-catalog.js";
import { mapCodexSkill } from "./mapper.js";
import type { CodexSessionContext } from "./session-context.js";
import { asObject, firstString } from "./protocol-utils.js";

/** Implements Codex ephemeral side conversations and durable response forks. */
export class CodexSessionForkAdapter implements ProviderForkPort {
  constructor(private readonly context: CodexSessionContext) {}

  async forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before creating a side conversation");
    const forked = asObject(await session.api.forkThread(threadId, { ephemeral: true, excludeTurns: true }));
    const forkedThread = asObject(forked?.thread);
    const sideThreadId = firstString(forkedThread?.id);
    if (!forked || !forkedThread || !sideThreadId) throw new Error("Codex returned an invalid thread/fork response");

    const cwd = firstString(forked.cwd, forkedThread.cwd) ?? "";
    const parentSettings = session.settingsByThread.get(threadId);
    const model = firstString(forked.model) ?? parentSettings?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(forked.reasoningEffort) ?? parentSettings?.effort ?? null;
    const permissionProfile = firstString(asObject(forked.activePermissionProfile)?.id) ?? parentSettings?.permissionProfile ?? null;
    session.activeThreadId = sideThreadId;
    session.openedThreadIds.add(sideThreadId);
    session.settingsByThread.set(sideThreadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode: parentSettings?.collaborationMode ?? "default" });
    const catalog = session.skillsByThread.get(threadId) ?? await discoverCodexSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(sideThreadId, catalog);
    return {
      target,
      threadId: sideThreadId,
      title: "사이드 채팅",
      cwd,
      skills: catalog.skills.map(mapCodexSkill),
      skillWarnings: catalog.warnings,
      model,
      reasoningEffort,
      permissionProfile,
    };
  }

  async forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before creating a fork");
    let forkTurnId = input.turnId;
    if (!forkTurnId && input.messageId) {
      const source = asObject((await session.api.readThread(threadId)).thread);
      const turns = Array.isArray(source?.turns) ? source.turns : [];
      const containingTurn = turns.find((turnValue) => {
        const turn = asObject(turnValue);
        const items = Array.isArray(turn?.items) ? turn.items : [];
        return items.some((itemValue) => firstString(asObject(itemValue)?.id) === input.messageId);
      });
      forkTurnId = firstString(asObject(containingTurn)?.id);
    }
    if (!forkTurnId) throw new Error("Codex could not resolve the selected response to a completed turn");
    const forked = asObject(await session.api.forkThread(threadId, { lastTurnId: forkTurnId, ephemeral: false }));
    const forkedThread = asObject(forked?.thread);
    const forkedId = firstString(forkedThread?.id);
    if (!forked || !forkedThread || !forkedId) throw new Error("Codex returned an invalid thread/fork response");
    let renamed = false;
    try {
      await session.api.setThreadName(forkedId, input.name);
      renamed = true;
    } catch {}
    const cwd = firstString(forked.cwd, forkedThread.cwd) ?? "";
    const parentSettings = session.settingsByThread.get(threadId);
    const model = firstString(forked.model) ?? parentSettings?.model ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(forked.reasoningEffort) ?? parentSettings?.effort ?? null;
    const permissionProfile = firstString(asObject(forked.activePermissionProfile)?.id) ?? parentSettings?.permissionProfile ?? null;
    session.openedThreadIds.add(forkedId);
    session.settingsByThread.set(forkedId, { model, effort: reasoningEffort, permissionProfile, collaborationMode: parentSettings?.collaborationMode ?? "default" });
    const catalog = session.skillsByThread.get(threadId) ?? await discoverCodexSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(forkedId, catalog);
    return {
      target,
      threadId: forkedId,
      title: renamed ? input.name : firstString(forkedThread.name, forkedThread.title) ?? input.name,
      cwd,
      preview: "",
      updatedAt: Date.now(),
      provider: "codex",
    };
  }
}
