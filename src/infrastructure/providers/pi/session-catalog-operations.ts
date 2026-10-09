import type { ProviderCatalogPort, ProviderConnectionCatalog } from "../../../application/ports/provider-catalog.js";
import type { AssistantThread } from "../../../domain/assistant.js";
import { PiSessionContext } from "./session-context.js";

/** Owns Pi connection catalog discovery and refresh. */
export class PiSessionCatalogOperations implements ProviderCatalogPort {
  constructor(private readonly context: PiSessionContext) {}

  async connect(target: string): Promise<ProviderConnectionCatalog> {
    const state = await this.context.getOrConnect(target);
    return {
      threads: [...state.threads.values()].map(({ thread }) => thread)
        .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt)),
      models: state.models,
    };
  }

  refresh(target: string): Promise<AssistantThread[]> {
    return this.context.refresh(target);
  }

  disconnect(target: string): Promise<void> {
    return this.context.disconnect(target);
  }
}

function timestamp(value: string | number | null): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
