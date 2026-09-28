import type { Dispatch, SetStateAction } from "react";
import type { ApprovalUiRequest } from "../../shared/bridge-event-adapter";
import { bridgeRpc } from "../../bridgeClient";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ApprovalResponseOptions = {
  state: {
    connectedTarget: string;
    approval: ApprovalUiRequest | null;
  };
  setters: {
    setNotice: StateSetter<string>;
    setApproval: StateSetter<ApprovalUiRequest | null>;
  };
};

/** Resolve an approval request independently from prompt and turn controls. */
export function useApprovalResponse({ state, setters }: ApprovalResponseOptions) {
  const answerApproval = async (decision: "accept" | "acceptForSession" | "decline"): Promise<void> => {
    if (!state.approval) return;
    try {
      await bridgeRpc.request.answerApproval({
        target: state.connectedTarget,
        requestId: state.approval.requestId,
        decision,
        provider: state.approval.provider,
      });
    } catch (error) {
      setters.setNotice(errorMessage(error));
    } finally {
      setters.setApproval(null);
    }
  };

  return { answerApproval };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
