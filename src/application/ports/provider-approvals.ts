import type { AssistantProvider } from "../../domain/provider-catalog.js";

export type ApprovalDecision = "accept" | "acceptForSession" | "decline";
export type ProviderApprovalResult = { answered: true };

/** Resolve an outstanding provider approval request. */
export interface ProviderApprovalsPort {
  answerApproval(target: string, requestId: number | string, decision: ApprovalDecision): Promise<ProviderApprovalResult>;
}

export type ProviderApprovalsPorts = Record<AssistantProvider, ProviderApprovalsPort>;
