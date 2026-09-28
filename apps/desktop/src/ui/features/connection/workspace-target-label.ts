import { LOCAL_WORKSPACE_TARGET } from "../../../shared/bridge";

export function isRelayWorkspaceTarget(value: string): boolean {
  return value.startsWith("hive+");
}

export function formatWorkspaceTargetLabel(value: string): string {
  if (value === LOCAL_WORKSPACE_TARGET) return "로컬 host";
  if (!isRelayWorkspaceTarget(value)) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol + "//" + parsed.host + parsed.pathname;
  } catch {
    return "Hive TCP relay";
  }
}
