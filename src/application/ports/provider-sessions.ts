import type { AssistantProvider } from "../../domain/provider-catalog.js";

/** Provider session lifecycle operations separate from catalog discovery. */
export interface ProviderSessionPort {
  renameThread(target: string, threadId: string, name: string): Promise<void>;
  deleteThread(target: string, threadId: string): Promise<void>;
}

export type ProviderSessionPorts = Record<AssistantProvider, ProviderSessionPort>;
