import { useRef, type Dispatch, type SetStateAction } from "react";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import type { ApprovalUiRequest } from "../../shared/bridge-events";
import { providerDisplayName } from "../../shared/provider-display-name";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

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
  const { bridge } = useDesktopUiRuntime();
  const answering = useRef(false);
  const answerApproval = async (decision: "accept" | "acceptForSession" | "decline"): Promise<void> => {
    if (!state.approval || answering.current) return;
    answering.current = true;
    const provider = state.approval.provider;
    try {
      if (!assistantProviderSupports(provider, "approvals")) {
        throw new Error(`${providerDisplayName(provider)} does not support answering approval requests.`);
      }
      await bridge.bridgeRpc.request.answerApproval({
        target: state.approval.target ?? state.connectedTarget,
        requestId: state.approval.requestId,
        decision,
        provider,
      });
      setters.setApproval(null);
    } catch (error) {
      setters.setNotice(errorMessage(error));
    } finally {
      answering.current = false;
    }
  };

  return { answerApproval };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
