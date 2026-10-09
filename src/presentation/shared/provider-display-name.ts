import type { AssistantProvider } from "./bridge";
import { ASSISTANT_PROVIDERS } from "../../domain/provider-catalog.js";

export function providerDisplayName(provider: AssistantProvider): string {
  return ASSISTANT_PROVIDERS.find((item) => item.id === provider)?.name ?? provider;
}
