import type { AssistantEventPublisher } from "../../../application/ports/events.js";
import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import { saveKiroSessionPolicyPresets } from "../../persistence/kiro-session-metadata.js";
import { kiroEffortOptions, withKiroEffortOptions } from "./session-catalog-mapper.js";
import { publishKiroEvent } from "./session-events.js";
import { kiroPermissionPresetsForProfile } from "./session-metadata.js";
import type { KiroRemoteSession } from "./session-types.js";
import type { KiroRequireOpenThread } from "./thread-access.js";
import { firstString } from "./session-utils.js";

/** Applies Kiro model, Thinking, permission, and agent-mode settings. */
export class KiroSessionSettingsAdapter implements ProviderSettingsPort {
  constructor(
    private readonly requireOpenThread: KiroRequireOpenThread,
    private readonly publish: AssistantEventPublisher,
  ) {}

  async updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    const session = await this.requireOpenThread(target, threadId);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this Kiro session before changing its settings");
    const current = session.settingsByThread.get(threadId) ?? { model: "", effort: null };
    let selectedModel = current.model;
    let selectedEffort = current.effort;
    let supportedReasoningEfforts: ProviderThreadSettingsResult["supportedReasoningEfforts"];
    if (input.permissionProfile !== undefined) {
      const nextPresets = kiroPermissionPresetsForProfile(input.permissionProfile);
      await this.applyKiroPermissionProfile(session, threadId, input.permissionProfile);
      await saveKiroSessionPolicyPresets(target, threadId, nextPresets);
      session.policyPresetsByThread.set(threadId, nextPresets);
      publishKiroEvent(this.publish, target, threadId, {
        type: "threadSettingsUpdated",
        settings: { permissionProfile: input.permissionProfile },
      });
    }
    if (input.model) {
      if (!session.models.some((candidate) => candidate.model === input.model && !candidate.hidden)) throw new Error("The selected model is not in the Kiro model list");
      await session.connection.setModel(threadId, input.model);
      selectedModel = input.model;
      const effortOptions = await kiroEffortOptions(session, threadId);
      selectedEffort = effortOptions.current ?? null;
      supportedReasoningEfforts = effortOptions.options;
      session.models = withKiroEffortOptions(session.models, input.model, effortOptions.options);
    }
    if (input.effort) {
      const options = supportedReasoningEfforts ?? session.models.find((candidate) => candidate.model === selectedModel)?.supportedReasoningEfforts ?? [];
      if (!options.some((candidate) => candidate.reasoningEffort === input.effort)) throw new Error(`${input.effort} is not supported by the selected Kiro model`);
      const result = await session.connection.executeCommand(threadId, "effort", { value: input.effort });
      if (result.success === false) throw new Error(firstString(result.message) ?? `Kiro Thinking 수준을 ${input.effort}(으)로 바꾸지 못했습니다.`);
      selectedEffort = input.effort;
    }
    let selectedModeId = session.currentModeByThread.get(threadId);
    if (input.modeId) {
      if (!session.modesByThread.get(threadId)?.some((candidate) => candidate.id === input.modeId)) throw new Error("The selected Kiro agent mode is not available in this session");
      await session.connection.setMode(threadId, input.modeId);
      selectedModeId = input.modeId;
      session.currentModeByThread.set(threadId, input.modeId);
    }
    if (!input.model && !input.effort && !input.modeId && input.permissionProfile === undefined) throw new Error("Select a Kiro model, Thinking level, permission profile, or agent mode to update");
    session.settingsByThread.set(threadId, { model: selectedModel, effort: selectedEffort });
    return {
      updated: true,
      ...(input.model ? { model: selectedModel } : {}),
      ...(input.effort ? { effort: selectedEffort ?? input.effort } : input.model && selectedEffort ? { effort: selectedEffort } : {}),
      ...(input.permissionProfile !== undefined ? { permissionProfile: input.permissionProfile } : {}),
      ...(input.modeId && selectedModeId ? { currentModeId: selectedModeId } : {}),
      ...(supportedReasoningEfforts ? { supportedReasoningEfforts } : {}),
    };
  }

  private async applyKiroPermissionProfile(
    session: KiroRemoteSession,
    threadId: string,
    profile: string,
  ): Promise<void> {
    const executeToolsCommand = async (value: string): Promise<void> => {
      const result = await session.connection.executeCommand(threadId, "tools", { value });
      if (result.success === false) throw new Error(firstString(result.message) ?? `Kiro 도구 권한을 '${value}'(으)로 변경하지 못했습니다.`);
    };
    await executeToolsCommand("reset");
    if (profile === "allow-all") {
      await executeToolsCommand("trust-all");
    } else if (profile === "read-only") {
      for (const tool of ["read", "grep", "glob"]) await executeToolsCommand(`trust ${tool}`);
    } else if (profile !== "user-choice") {
      throw new Error(`Unknown Kiro permission profile: ${profile}`);
    }
  }
}
