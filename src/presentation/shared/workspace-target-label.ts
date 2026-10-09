import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";

export function formatWorkspaceTargetLabel(value: string): string {
  if (value === LOCAL_WORKSPACE_TARGET) return "로컬 host";
  return value;
}
