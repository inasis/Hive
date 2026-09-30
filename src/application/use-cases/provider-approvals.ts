import type { AssistantProvider } from "../../domain/provider-catalog.js";
import type { ApprovalDecision, ProviderApprovalResult, ProviderApprovalsPorts } from "../ports/provider-approvals.js";
import { requireProviderCapability } from "../policies/provider-capability.js";

/** Provider-neutral selection and dispatch for approval responses. */
export class ProviderApprovalUseCases<Provider extends AssistantProvider = AssistantProvider> {
  constructor(private readonly providers: Pick<ProviderApprovalsPorts, Provider>) {}

  answerApproval(provider: Provider, target: string, requestId: number | string, decision: ApprovalDecision): Promise<ProviderApprovalResult> {
    requireProviderCapability(provider, "approvals", "answering approval requests");
    return this.providers[provider].answerApproval(target, requestId, decision);
  }
}
