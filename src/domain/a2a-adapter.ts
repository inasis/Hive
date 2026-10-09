export type AdapterCapabilities = {
  discoverSessions: boolean;
  attachExistingProcess: boolean;
  resumeSession: boolean;
  persistentContext: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  cancellation: boolean;
  toolCalling: boolean;
  fileAccess: boolean;
  shellAccess: boolean;
  delegation: boolean;
  concurrentTasks: boolean;
};

export type IntegrationEvidence = {
  source:
    | "official-sdk"
    | "official-api"
    | "official-cli"
    | "documented-command"
    | "observed-cli"
    | "pty"
    | "local-state"
    | "hive-provider-port"
    | "unsupported";
  verifiedVersion?: string;
  verifiedAt: string;
  limitations: string[];
  confidence: "high" | "medium" | "low";
};

export type AdapterErrorCode =
  | "PROVIDER_NOT_INSTALLED"
  | "AUTH_REQUIRED"
  | "SESSION_NOT_FOUND"
  | "SESSION_CREATE_UNSUPPORTED"
  | "RESUME_UNSUPPORTED"
  | "ATTACH_UNSUPPORTED"
  | "WORKSPACE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "INTERACTIVE_APPROVAL_REQUIRED"
  | "PERMISSION_RESTORE_FAILED"
  | "OUTPUT_PARSE_FAILED"
  | "TIMEOUT"
  | "CANCEL_UNSUPPORTED"
  | "PROCESS_EXITED"
  | "PROVIDER_UNAVAILABLE"
  | "UNVERIFIED_INTEGRATION"
  | "INVALID_REQUEST"
  | "NO_AGENT_AVAILABLE"
  | "CYCLE_DETECTED"
  | "MAX_DEPTH_EXCEEDED";

export type AdapterError = {
  code: AdapterErrorCode;
  provider: string;
  message: string;
  retryable: boolean;
};
