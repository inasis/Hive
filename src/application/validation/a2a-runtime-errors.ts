import type { AdapterError, AdapterErrorCode } from "../../domain/a2a-adapter.js";
import { isRecord } from "./a2a-runtime-values.js";

export class A2ARuntimeFault extends Error {
  constructor(readonly detail: AdapterError) {
    super(detail.message);
    this.name = "A2ARuntimeFault";
  }
}

export function normalizeAdapterError(error: unknown, provider: string): AdapterError {
  if (error instanceof A2ARuntimeFault) return { ...error.detail, provider: error.detail.provider || provider };
  if (isRecord(error) && isAdapterErrorCode(error.code)) {
    return {
      code: error.code,
      provider: typeof error.provider === "string" && error.provider ? error.provider : provider,
      message: typeof error.message === "string" ? error.message : "Agent adapter failed",
      retryable: error.retryable === true,
    };
  }
  return runtimeFault("PROVIDER_UNAVAILABLE", provider, "Agent adapter failed", true).detail;
}

export function runtimeFault(code: AdapterErrorCode, provider: string, message: string, retryable = false): A2ARuntimeFault {
  return new A2ARuntimeFault({ code, provider, message, retryable });
}

function isAdapterErrorCode(value: unknown): value is AdapterErrorCode {
  return typeof value === "string" && [
    "PROVIDER_NOT_INSTALLED", "AUTH_REQUIRED", "SESSION_NOT_FOUND", "SESSION_CREATE_UNSUPPORTED", "RESUME_UNSUPPORTED", "ATTACH_UNSUPPORTED",
    "WORKSPACE_NOT_FOUND", "PERMISSION_DENIED", "INTERACTIVE_APPROVAL_REQUIRED", "PERMISSION_RESTORE_FAILED", "OUTPUT_PARSE_FAILED", "TIMEOUT",
    "CANCEL_UNSUPPORTED", "PROCESS_EXITED", "PROVIDER_UNAVAILABLE", "UNVERIFIED_INTEGRATION", "INVALID_REQUEST",
    "NO_AGENT_AVAILABLE", "CYCLE_DETECTED", "MAX_DEPTH_EXCEEDED",
  ].includes(value);
}
