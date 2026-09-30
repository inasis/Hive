import type { A2ACommunicationSummaryItem } from "../../domain/a2a.js";

/** An agent message delivered to a Hive session and waiting for interpretation. */
export type PendingA2ACommunication = A2ACommunicationSummaryItem;

export type A2ACommunicationClaim = {
  claimId: string;
  communications: PendingA2ACommunication[];
};

/** Lets the next provider prompt collect queued A2A replies without exposing them as chat input. */
export interface A2APromptInboxPort {
  claimForPrompt(provider: string, target: string, threadId: string): Promise<A2ACommunicationClaim | undefined>;
  acceptPromptClaim(claimId: string, turnId?: string): Promise<void>;
  releasePromptClaim(claimId: string): Promise<void>;
}
