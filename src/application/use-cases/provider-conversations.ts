import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type {
  ProviderConversationPorts,
  ProviderCreateThreadInput,
  ProviderCreateThreadResult,
  ProviderOpenThreadResult,
} from "../ports/provider-conversations.js";
import { requireProviderCapability } from "./provider-capability.js";
import { validateThreadId } from "./provider-sessions.js";

/** Provider-neutral validation and dispatch for creating and opening sessions. */
export class ProviderConversationUseCases {
  constructor(private readonly providers: ProviderConversationPorts) {}

  createThread(
    provider: AssistantProvider,
    target: string,
    input: ProviderCreateThreadInput,
  ): Promise<ProviderCreateThreadResult> {
    const cwd = input.cwd.trim();
    if (!cwd) throw new Error("Choose a remote workspace path before creating a session");
    if (input.name?.trim()) requireProviderCapability(provider, "createNamedSessions", "creating named sessions");
    if (input.permissionPresets?.length) requireProviderCapability(provider, "permissionProfileCreation", "choosing permission profiles when creating sessions");
    return this.providers[provider].createThread(target, { ...input, cwd });
  }

  openThread(provider: AssistantProvider, target: string, threadId: string): Promise<ProviderOpenThreadResult> {
    validateThreadId(threadId);
    return this.providers[provider].openThread(target, threadId);
  }
}
