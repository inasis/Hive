import type { AssistantProvider } from "../../shared/bridge";
import { ASSISTANT_PROVIDERS } from "../../../../../src/domain/provider-catalog.js";

export function providerDisplayName(provider: AssistantProvider): string {
  return ASSISTANT_PROVIDERS.find((item) => item.id === provider)?.name ?? provider;
}
