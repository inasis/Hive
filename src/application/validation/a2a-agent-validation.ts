import type { AdapterCapabilities, AdapterErrorCode } from "../../domain/a2a-adapter.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapterDescriptor } from "../ports/a2a-agent-adapter.js";
import { runtimeFault } from "./a2a-runtime-errors.js";
import { isRecord } from "./a2a-runtime-values.js";
import { requireNonEmpty } from "./a2a-runtime-validation.js";

/** Validate provider adapter capability and evidence before it enters the runtime. */
export function validateAdapterDescriptor(descriptor: AgentAdapterDescriptor): void {
  requireNonEmpty(descriptor.provider, "provider");
  const expectedCapabilities: Array<keyof AdapterCapabilities> = [
    "discoverSessions", "attachExistingProcess", "resumeSession", "persistentContext", "structuredOutput",
    "streaming", "cancellation", "toolCalling", "fileAccess", "shellAccess", "delegation", "concurrentTasks",
  ];
  if (!isRecord(descriptor.capabilities) || expectedCapabilities.some((key) => typeof descriptor.capabilities[key] !== "boolean")) {
    throw new Error("Adapter capabilities must be explicit boolean values");
  }
  if (descriptor.integrationStatus !== "VERIFIED" && descriptor.integrationStatus !== "PARTIALLY_VERIFIED" &&
      descriptor.integrationStatus !== "EXPERIMENTAL" && descriptor.integrationStatus !== "UNAVAILABLE" &&
      descriptor.integrationStatus !== "MANUAL_CONFIGURATION_REQUIRED") throw new Error("Adapter integration status is invalid");
  if (!isRecord(descriptor.evidence) || typeof descriptor.evidence.verifiedAt !== "string" ||
      (descriptor.evidence.source !== "official-sdk" && descriptor.evidence.source !== "official-api" &&
        descriptor.evidence.source !== "official-cli" && descriptor.evidence.source !== "documented-command" &&
        descriptor.evidence.source !== "observed-cli" && descriptor.evidence.source !== "pty" &&
        descriptor.evidence.source !== "local-state" && descriptor.evidence.source !== "hive-provider-port" &&
        descriptor.evidence.source !== "unsupported") ||
      !Array.isArray(descriptor.evidence.limitations) || descriptor.evidence.limitations.some((item) => typeof item !== "string") ||
      (descriptor.evidence.verifiedVersion !== undefined && typeof descriptor.evidence.verifiedVersion !== "string") ||
      (descriptor.evidence.confidence !== "high" && descriptor.evidence.confidence !== "medium" && descriptor.evidence.confidence !== "low")) {
    throw new Error("Adapter integration evidence is invalid");
  }
  if (descriptor.evidence.source === "unsupported" && descriptor.integrationStatus !== "UNAVAILABLE" &&
      descriptor.integrationStatus !== "MANUAL_CONFIGURATION_REQUIRED") {
    throw new Error("Unsupported integration evidence cannot be marked routable");
  }
  if (descriptor.evidence.confidence === "low" && descriptor.integrationStatus === "VERIFIED") {
    throw new Error("Low-confidence integration evidence cannot be marked verified");
  }
}

/** Validate native session shape and whether the adapter supports its persistence mode. */
export function validateNativeSession(value: NativeSession): void {
  if (!isNativeSession(value)) throw runtimeFault("INVALID_REQUEST", "", "Native session descriptor is invalid");
}

export function sessionCapabilityError(session: NativeSession, descriptor: AgentAdapterDescriptor): AdapterErrorCode | undefined {
  if (session.persistenceLevel === 1 && !descriptor.capabilities.persistentContext) return "UNVERIFIED_INTEGRATION";
  if (session.persistenceLevel === 2 && (!descriptor.capabilities.persistentContext || !descriptor.capabilities.resumeSession)) {
    return "RESUME_UNSUPPORTED";
  }
  if (session.persistenceLevel === 3 && (!descriptor.capabilities.persistentContext || !descriptor.capabilities.attachExistingProcess)) return "ATTACH_UNSUPPORTED";
  return undefined;
}

export function isNativeSession(value: unknown): value is NativeSession {
  if (!isRecord(value)) return false;
  const level = value.persistenceLevel;
  return typeof value.sessionId === "string" && value.sessionId.length > 0 &&
    typeof value.provider === "string" && value.provider.length > 0 &&
    (value.sessionName === undefined || typeof value.sessionName === "string") &&
    (value.workspace === undefined || typeof value.workspace === "string") &&
    (level === 0 || level === 1 || level === 2 || level === 3) &&
    typeof value.runtimeManagedHistory === "boolean" && (level !== 1 || value.runtimeManagedHistory);
}
