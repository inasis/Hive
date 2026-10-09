import type { RoutingPolicy } from "../../domain/collaboration/aggregates/task.js";
import { runtimeFault } from "./a2a-runtime-errors.js";

/** Validate application-owned A2A routing configuration before task scheduling. */
export function validatePolicy(policy: RoutingPolicy): void {
  if (!Number.isSafeInteger(policy.maxDepth) || policy.maxDepth < 0 || policy.maxDepth > 64) {
    throw new Error("A2A maxDepth policy must be an integer from 0 to 64");
  }
  if (!Number.isSafeInteger(policy.defaultTimeoutMs) || policy.defaultTimeoutMs < 0) {
    throw new Error("A2A defaultTimeoutMs policy must be a non-negative integer");
  }
  for (const value of [policy.allowExperimentalAdapters, policy.allowQueueing]) {
    if (typeof value !== "boolean") throw new Error("A2A routing policy flags must be boolean");
  }
  for (const value of [policy.requireResumeCapability, policy.requireStructuredOutput, policy.requireCancellation]) {
    if (value !== undefined && typeof value !== "boolean") throw new Error("A2A routing capability requirements must be boolean");
  }
}

export function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw runtimeFault("INVALID_REQUEST", "", `${field} must be a non-empty string`);
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}
