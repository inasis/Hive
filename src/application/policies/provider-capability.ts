import {
  ASSISTANT_PROVIDERS,
  assistantProviderSupports,
  type AssistantProvider,
  type AssistantProviderCapability,
} from "../../domain/provider-catalog.js";

/** Reject provider operations that the shared capability catalog marks unavailable. */
export function requireProviderCapability(
  provider: AssistantProvider,
  capability: AssistantProviderCapability,
  action: string,
): void {
  if (assistantProviderSupports(provider, capability)) return;
  const descriptor = ASSISTANT_PROVIDERS.find((candidate) => candidate.id === provider);
  throw new Error(`${descriptor?.name ?? provider} does not support ${action}.`);
}
