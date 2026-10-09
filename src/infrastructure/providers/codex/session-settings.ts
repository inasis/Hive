import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { CodexSessionContext } from "./session-context.js";
import { asObject } from "./protocol-utils.js";
import { isCodexPermissionPreset } from "./session-metadata.js";

/** Applies Codex model, Thinking, permission, and collaboration-mode settings. */
export class CodexSessionSettingsAdapter implements ProviderSettingsPort {
  constructor(private readonly context: CodexSessionContext) {}

  async updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    const session = await this.context.getOrConnect(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Codex session before changing its settings");
    const { model, effort, permissionProfile, modeId } = input;
    const current = session.settingsByThread.get(threadId);
    const selectedModel = model ?? current?.model;
    const modelInfo = selectedModel ? session.models.find((candidate) => candidate.model === selectedModel) : undefined;
    if (model && !modelInfo) throw new Error("The selected model is not in the remote Codex model list");
    if (effort && modelInfo && !modelInfo.supportedReasoningEfforts.some((candidate) => candidate.reasoningEffort === effort)) {
      throw new Error(`${effort} is not supported by ${modelInfo.displayName}`);
    }
    if (permissionProfile && !isCodexPermissionPreset(permissionProfile)) {
      throw new Error("The selected permission profile is not supported");
    }
    let collaborationModeUpdate: { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions: null } } | undefined;
    if (modeId) {
      if (modeId !== "default" && modeId !== "plan") throw new Error("The selected Codex mode is not supported");
      if (modeId === "plan") {
        const modes = asObject(await session.api.listCollaborationModes());
        const presets = Array.isArray(modes?.data) ? modes.data.map(asObject).filter((value): value is Record<string, unknown> => Boolean(value)) : [];
        if (!presets.some((preset) => preset.mode === modeId)) throw new Error("Codex Plan mode is not available");
      }
      collaborationModeUpdate = {
        mode: modeId,
        settings: {
          model: selectedModel ?? "",
          reasoning_effort: effort ?? current?.effort ?? null,
          developer_instructions: null,
        },
      };
    }
    if (!model && !effort && !permissionProfile && !modeId) {
      throw new Error("Select a model, Thinking level, permission profile, or mode to update");
    }
    await session.api.updateThreadSettings(threadId, {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(permissionProfile ? {
        permissions: permissionProfile,
        approvalPolicy: permissionProfile === ":danger-full-access" ? "never" : "on-request",
      } : {}),
      ...(collaborationModeUpdate ? { collaborationMode: collaborationModeUpdate } : {}),
    });
    session.settingsByThread.set(threadId, {
      model: selectedModel ?? "",
      effort: effort ?? current?.effort ?? null,
      permissionProfile: permissionProfile ?? current?.permissionProfile ?? null,
      collaborationMode: modeId === "plan" || modeId === "default" ? modeId : current?.collaborationMode ?? "default",
    });
    return {
      updated: true,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(permissionProfile ? { permissionProfile } : {}),
      ...(modeId ? { currentModeId: modeId } : {}),
    };
  }
}
