import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type {
  ProviderConversationPorts,
  ProviderCreateThreadInput,
  ProviderCreateThreadResult,
  ProviderOpenThreadOptions,
  ProviderOpenThreadResult,
} from "../ports/provider-conversations.js";
import { requireProviderCapability } from "../policies/provider-capability.js";
import { validateThreadId } from "../validation/thread-id.js";
import type { SessionIdentityPort } from "../ports/session-identities.js";
import { bindHiveSessionIdentity, resolveHiveSessionIdentity } from "./session-identity-resolution.js";

/** Provider-neutral validation and dispatch for creating and opening sessions. */
export class ProviderConversationUseCases {
  constructor(
    private readonly providers: ProviderConversationPorts,
    private readonly identities?: SessionIdentityPort,
    private readonly onSessionCreated?: () => void,
  ) {}

  async createThread(
    provider: AssistantProvider,
    target: string,
    input: ProviderCreateThreadInput,
  ): Promise<ProviderCreateThreadResult> {
    const cwd = input.cwd.trim();
    if (!cwd) throw new Error("Choose a remote workspace path before creating a session");
    if (input.name !== undefined) requireProviderCapability(provider, "createNamedSessions", "creating named sessions");
    if (input.permissionPresets !== undefined) requireProviderCapability(provider, "permissionProfileCreation", "choosing permission profiles when creating sessions");
    const created = this.identities
      ? await this.createIdentifiedThread(provider, target, { ...input, cwd })
      : await this.providers[provider].createThread(target, { ...input, cwd });
    this.onSessionCreated?.();
    return created;
  }

  async openThread(provider: AssistantProvider, target: string, threadId: string, options?: ProviderOpenThreadOptions): Promise<ProviderOpenThreadResult> {
    validateThreadId(threadId);
    const opened = await this.providers[provider].openThread(target, threadId, options);
    if (!this.identities) return opened;
    const identity = await resolveHiveSessionIdentity(this.identities, provider, target, threadId, opened.title);
    return { ...opened, hiveSessionId: identity.hiveSessionId, title: identity.sessionName };
  }

  private async createIdentifiedThread(
    provider: AssistantProvider,
    target: string,
    input: ProviderCreateThreadInput,
  ): Promise<ProviderCreateThreadResult> {
    const ownsReservation = input.hiveSessionId === undefined;
    const hiveSessionId = input.hiveSessionId ?? await this.identities!.reserve();
    try {
      const created = await this.providers[provider].createThread(target, { ...input, hiveSessionId });
      const providerSessionName = created.thread.title.trim() || created.title.trim() || input.name;
      const identity = await bindHiveSessionIdentity(this.identities!, provider, target, created.threadId, hiveSessionId, providerSessionName);
      return {
        ...created,
        hiveSessionId: identity.hiveSessionId,
        title: identity.sessionName,
        thread: { ...created.thread, hiveSessionId: identity.hiveSessionId, title: identity.sessionName },
      };
    } catch (error) {
      if (ownsReservation) this.identities!.release(hiveSessionId);
      throw error;
    }
  }
}
