import type { CodexCliOpenedSession, CodexCliSessionPort } from "../../../application/ports/codex-cli.js";
import { discoverCodexSkills } from "./skill-catalog.js";
import { formatCodexTargetLabel, type CodexSessionContext } from "./session-context.js";
import { asObject, firstString } from "./protocol-utils.js";

/** Opens a Codex thread for the interactive CLI and prepares its skill catalog. */
export class CodexCliSessionOpener implements CodexCliSessionPort {
  constructor(private readonly context: CodexSessionContext) {}

  async openSession(target: string, threadId: string): Promise<CodexCliOpenedSession> {
    const session = await this.context.getOrConnect(target);
    const metadata = asObject(await session.api.readThreadMetadata(threadId));
    const storedThread = asObject(metadata?.thread);
    if (!storedThread) throw new Error("Codex returned an invalid thread/read response");
    const resumeResponse = asObject(await session.api.resumeThread(threadId, { excludeTurns: true }));
    const resumedThread = asObject(resumeResponse?.thread);
    if (!resumedThread) throw new Error("Codex returned an invalid thread/resume response");

    const cwd = typeof resumedThread.cwd === "string" ? resumedThread.cwd : undefined;
    const model = firstString(resumeResponse?.model) ?? session.models.find((candidate) => candidate.isDefault)?.model ?? "";
    const reasoningEffort = firstString(resumeResponse?.reasoningEffort) ?? null;
    const permissionProfile = firstString(asObject(resumeResponse?.activePermissionProfile)?.id) ?? null;
    const collaborationMode = firstString(asObject(resumeResponse?.collaborationMode)?.mode) === "plan" ? "plan" : "default";
    session.activeThreadId = threadId;
    session.openedThreadIds.add(threadId);
    session.settingsByThread.set(threadId, { model, effort: reasoningEffort, permissionProfile, collaborationMode });
    const skillCatalog = await discoverCodexSkills(session.api, target, cwd || undefined);
    session.skillsByThread.set(threadId, skillCatalog);
    return {
      targetLabel: formatCodexTargetLabel(target),
      ...(typeof resumedThread.name === "string" ? { title: resumedThread.name } : {}),
      ...(cwd ? { cwd } : {}),
      skillCatalog,
    };
  }
}
