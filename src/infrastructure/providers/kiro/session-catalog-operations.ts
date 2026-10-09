import type { AssistantThread } from "../../../domain/assistant.js";
import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import { listKiroModels, listKiroSessions } from "./cli.js";
import { listKiroPermissionPresetOptions } from "./session-metadata.js";
import { KiroSessionContext } from "./session-context.js";
import { errorMessage } from "./session-utils.js";

/** Owns Kiro catalog discovery and provider connection lifecycle. */
export class KiroSessionCatalogOperations implements ProviderCatalogPort {
  constructor(private readonly context: KiroSessionContext) {}

  async connect(target: string): Promise<ProviderConnectionCatalog> {
    const session = await this.context.getOrConnect(target);
    let modelWarning: string | undefined;
    if (!session.models.length) {
      try {
        session.models = await listKiroModels(target);
      } catch (error) {
        modelWarning = errorMessage(error);
      }
    }
    return {
      threads: (await listKiroSessions(target)).map((thread) => ({ ...thread, provider: "kiro" as const })),
      models: session.models,
      permissionPresets: listKiroPermissionPresetOptions(),
      ...(modelWarning ? { modelWarning } : {}),
    };
  }

  async refresh(target: string): Promise<AssistantThread[]> {
    return (await listKiroSessions(target)).map((thread) => ({ ...thread, provider: "kiro" as const }));
  }

  disconnect(target: string): Promise<void> {
    return this.context.disconnect(target);
  }
}
