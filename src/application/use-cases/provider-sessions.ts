import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ProviderSessionPorts } from "../ports/provider-sessions.js";
import { requireProviderCapability } from "../policies/provider-capability.js";
import { validateThreadId } from "../validation/thread-id.js";

/** Provider neutral validation and dispatch for session rename and deletion. */
export class ProviderSessionUseCases {
  constructor(private readonly providers: ProviderSessionPorts) {}

  async renameThread(provider: AssistantProvider, target: string, threadId: string, requestedName: string): Promise<void> {
    validateThreadId(threadId);
    requireProviderCapability(provider, "renameSessions", "renaming sessions");
    const name = requestedName.trim();
    if (!name) throw new Error("Session name cannot be empty");
    if (name.length > 120) throw new Error("Session name cannot exceed 120 characters");
    await this.providers[provider].renameThread(target, threadId, name);
  }

  deleteThread(provider: AssistantProvider, target: string, threadId: string): Promise<void> {
    validateThreadId(threadId);
    return this.providers[provider].deleteThread(target, threadId);
  }
}
