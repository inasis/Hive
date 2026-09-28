import type { ProviderForkPort, ProviderForkThreadInput, ProviderForkThreadResult, ProviderSideConversationResult } from "../../../application/ports/provider-forks.js";
import { defaultOpenCodeModel } from "./model-mapper.js";
import { mapOpenCodeSession, openCodeModelFromSession } from "./conversation-mapper.js";
import type { OpenCodeSessionContext } from "./session-context.js";
import { mapOpenCodeSkill } from "./skill-mapper.js";

/** Implements OpenCode session and side-conversation forks. */
export class OpenCodeSessionForkAdapter implements ProviderForkPort {
  constructor(private readonly context: OpenCodeSessionContext) {}

  async forkSideThread(target: string, threadId: string): Promise<ProviderSideConversationResult> {
    const session = this.context.require(target);
    const forked = await session.connection.forkSession(threadId);
    const forkedId = forked.id;
    const mapped = mapOpenCodeSession(forked);
    const catalog = await session.connection.listModels(mapped.cwd || undefined);
    const model = session.settingsByThread.get(threadId)?.model ??
      openCodeModelFromSession(forked) ??
      defaultOpenCodeModel(catalog.models) ?? "";
    const skillCatalog = await this.context.loadSkills(session, forkedId, mapped.cwd);
    session.openedThreadIds.add(forkedId);
    session.cwdByThread.set(forkedId, mapped.cwd);
    session.settingsByThread.set(forkedId, { model });
    session.modelsByThread.set(forkedId, catalog.models);
    return {
      target,
      threadId: forkedId,
      title: mapped.title,
      cwd: mapped.cwd,
      skills: skillCatalog.skills.map(mapOpenCodeSkill),
      skillWarnings: skillCatalog.warnings,
      models: catalog.models,
      ...(catalog.modelWarning ? { modelWarning: catalog.modelWarning } : {}),
      model,
      reasoningEffort: null,
      permissionProfile: null,
    };
  }

  async forkThread(target: string, threadId: string, input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    if (!input.messageId) throw new Error("OpenCode fork requires a completed assistant message");
    const session = this.context.require(target);
    const forked = await session.connection.forkSession(threadId, input.messageId);
    const forkedId = forked.id;
    let renamed = false;
    try {
      await session.connection.renameSession(forkedId, input.name);
      renamed = true;
    } catch {}
    const mapped = mapOpenCodeSession(forked);
    const catalog = await session.connection.listModels(mapped.cwd || undefined);
    const model = session.settingsByThread.get(threadId)?.model ??
      openCodeModelFromSession(forked) ??
      defaultOpenCodeModel(catalog.models) ?? "";
    await this.context.loadSkills(session, forkedId, mapped.cwd);
    session.openedThreadIds.add(forkedId);
    session.cwdByThread.set(forkedId, mapped.cwd);
    session.settingsByThread.set(forkedId, { model });
    session.modelsByThread.set(forkedId, catalog.models);
    return {
      target,
      threadId: forkedId,
      title: renamed ? input.name : mapped.title,
      cwd: mapped.cwd,
      preview: "",
      updatedAt: Date.now(),
      provider: "opencode",
    };
  }
}
