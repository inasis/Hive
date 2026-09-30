import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { ApprovalUiRequest } from "../../shared/bridge-event-adapter";

/** Show concurrent approval requests one at a time while keeping their daemon identity. */
export function useApprovalQueue(): {
  approval: ApprovalUiRequest | null;
  setApproval: Dispatch<SetStateAction<ApprovalUiRequest | null>>;
} {
  const [approvals, setApprovals] = useState<ApprovalUiRequest[]>([]);
  const setApproval = useCallback<Dispatch<SetStateAction<ApprovalUiRequest | null>>>((update) => {
    setApprovals((current) => {
      const next = typeof update === "function" ? update(current[0] ?? null) : update;
      if (!next) return current.slice(1);
      const key = (item: ApprovalUiRequest) => `${item.target ?? ""}\u0000${item.provider}\u0000${item.requestId}`;
      const existing = current.findIndex((item) => key(item) === key(next));
      if (existing < 0) return [...current, next];
      return current.map((item, index) => index === existing ? next : item);
    });
  }, []);
  return { approval: approvals[0] ?? null, setApproval };
}
