import type { ProviderSettingsPort, ProviderThreadSettingsInput, ProviderThreadSettingsResult } from "../../../application/ports/provider-settings.js";
import type { OpenCodeSessionContext } from "./session-context.js";

/** Applies the model selection supported by an OpenCode session. */
export class OpenCodeSessionSettingsAdapter implements ProviderSettingsPort {
  constructor(private readonly context: OpenCodeSessionContext) {}

  async updateThreadSettings(target: string, threadId: string, input: ProviderThreadSettingsInput): Promise<ProviderThreadSettingsResult> {
    if (input.effort || input.permissionProfile) throw new Error("OpenCode does not expose Codex Thinking or permission profile settings.");
    const session = this.context.require(target);
    if (!session.openedThreadIds.has(threadId)) throw new Error("Open this OpenCode session before changing its settings");
    if (!input.model) throw new Error("Select an OpenCode model to update");
    const availableModels = session.modelsByThread.get(threadId) ?? session.connection.models;
    if (!availableModels.some((candidate) => candidate.model === input.model && !candidate.hidden)) {
      throw new Error("The selected model is not in the OpenCode model list for this workspace");
    }
    await session.connection.setSessionModel(threadId, input.model);
    session.settingsByThread.set(threadId, { model: input.model });
    return { updated: true, model: input.model };
  }
}
