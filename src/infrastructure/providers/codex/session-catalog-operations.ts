import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { AssistantThread } from "../../../domain/assistant.js";
import { listCodexThreads } from "./mapper.js";
import { type CodexSessionContext } from "./session-context.js";
import { listCodexPermissionPresetOptions } from "./session-metadata.js";
import { errorMessage } from "./protocol-utils.js";

/** Owns Codex catalog discovery and connection lifecycle operations. */
export class CodexSessionCatalogOperations implements ProviderCatalogPort {
  constructor(private readonly context: CodexSessionContext) {}

  async connect(target: string): Promise<ProviderConnectionCatalog> {
    const session = await this.context.getOrConnect(target);
    let modelWarning: string | undefined;
    if (session.models.length === 0) {
      try {
        session.models = await session.api.listModels();
      } catch (error) {
        modelWarning = errorMessage(error);
      }
    }
    return {
      threads: await listCodexThreads(session.api),
      models: session.models,
      permissionPresets: listCodexPermissionPresetOptions(),
      ...(modelWarning ? { modelWarning } : {}),
    };
  }

  async refresh(target: string): Promise<AssistantThread[]> {
    const session = await this.context.getOrConnect(target);
    return listCodexThreads(session.api);
  }

  disconnect(target: string): Promise<void> {
    return this.context.disconnect(target);
  }
}
