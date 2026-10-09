import { validatePromptFileAttachments } from "../../../domain/prompt-attachments.js";
import { parseAgentContextInput } from "../../../domain/agent-context.js";
import type { AgentContextDto, PromptFileAttachmentDto, PromptImageAttachmentDto } from "../prompt.js";
import { isAssistantProvider, type AssistantProvider } from "../../../domain/provider-catalog.js";
import { isDaemonApiMethod, type DaemonApiMethod, type DaemonApiRequest, type DaemonApiRequestMap } from "./daemon-api.js";

type FieldRule = "string" | "number" | "boolean" | "provider" | "string-array" | "images" | "files" | "agent-context" | "request-id" | "approval-decision";
type OptionalKeys<T extends object> = {
  [Key in keyof T]-?: {} extends Pick<T, Key> ? Key : never;
}[keyof T];
type RequiredKeys<T extends object> = Exclude<keyof T, OptionalKeys<T>>;
type FieldRuleFor<Value> =
  [NonNullable<Value>] extends [AgentContextDto] ? "agent-context" :
  [NonNullable<Value>] extends [PromptImageAttachmentDto[]] ? "images" :
  [NonNullable<Value>] extends [PromptFileAttachmentDto[]] ? "files" :
  [NonNullable<Value>] extends [string[]] ? "string-array" :
  [NonNullable<Value>] extends [AssistantProvider] ? "provider" :
  [NonNullable<Value>] extends ["accept" | "acceptForSession" | "decline"] ? "approval-decision" :
  [NonNullable<Value>] extends [number] ? "number" :
  [NonNullable<Value>] extends [boolean] ? "boolean" :
  [NonNullable<Value>] extends [string] ? "string" :
  [NonNullable<Value>] extends [string | number] ? "request-id" :
  never;
type RequestShapeFor<Params extends object> = {
  required: { [Key in RequiredKeys<Params>]: FieldRuleFor<Params[Key]> };
  optional: { [Key in OptionalKeys<Params>]-?: FieldRuleFor<Params[Key]> };
};

const REQUEST_SHAPES = {
  listProviders: { required: {}, optional: {} },
  connect: { required: { target: "string" }, optional: { provider: "provider" } },
  refresh: { required: { target: "string" }, optional: { provider: "provider" } },
  createThread: {
    required: { target: "string", cwd: "string" },
    optional: { provider: "provider", name: "string", permissionPresets: "string-array" },
  },
  renameThread: {
    required: { target: "string", threadId: "string", name: "string" },
    optional: { provider: "provider" },
  },
  deleteThread: { required: { target: "string", threadId: "string" }, optional: { provider: "provider" } },
  openThread: { required: { target: "string", threadId: "string" }, optional: { provider: "provider", includeTranscript: "boolean" } },
  forkSideThread: { required: { target: "string", threadId: "string" }, optional: { provider: "provider" } },
  forkThread: {
    required: { target: "string", threadId: "string", name: "string" },
    optional: { provider: "provider", turnId: "string", messageId: "string" },
  },
  listSkills: { required: { target: "string", threadId: "string" }, optional: { provider: "provider", cwd: "string" } },
  listCommands: { required: { target: "string", threadId: "string" }, optional: { provider: "provider", cwd: "string" } },
  runCommand: {
    required: { target: "string", threadId: "string", command: "string" },
    optional: { provider: "provider", arguments: "string", cwd: "string" },
  },
  sendPrompt: {
    required: { target: "string", threadId: "string", text: "string" },
    optional: { provider: "provider", skillId: "string", cwd: "string", images: "images", files: "files", agentContext: "agent-context" },
  },
  steerTurn: {
    required: { target: "string", threadId: "string", turnId: "string", text: "string" },
    optional: { provider: "provider", skillId: "string", cwd: "string", agentContext: "agent-context" },
  },
  interruptTurn: {
    required: { target: "string", threadId: "string", turnId: "string" },
    optional: { provider: "provider" },
  },
  updateThreadSettings: {
    required: { target: "string", threadId: "string" },
    optional: { provider: "provider", model: "string", effort: "string", permissionProfile: "string", modeId: "string" },
  },
  disconnect: { required: { target: "string" }, optional: { provider: "provider" } },
  answerApproval: {
    required: { target: "string", requestId: "request-id", decision: "approval-decision" },
    optional: { provider: "provider" },
  },
  terminalStart: {
    required: { target: "string", cwd: "string", sessionId: "string", cols: "number", rows: "number" },
    optional: {},
  },
  terminalInput: { required: { target: "string", sessionId: "string", data: "string" }, optional: {} },
  terminalResize: { required: { target: "string", sessionId: "string", cols: "number", rows: "number" }, optional: {} },
  terminalStop: { required: { target: "string", sessionId: "string" }, optional: {} },
  listWorkspaceFiles: { required: { target: "string", cwd: "string", path: "string" }, optional: {} },
  readWorkspaceFile: { required: { target: "string", cwd: "string", path: "string" }, optional: {} },
} as const satisfies { [Method in DaemonApiMethod]: RequestShapeFor<DaemonApiRequestMap[Method]> };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validateField(value: unknown, rule: FieldRule, field: string): void {
  if (rule === "agent-context") {
    try {
      parseAgentContextInput(value);
    } catch (error) {
      throw new Error(`${field} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (rule === "string" && typeof value !== "string") throw new Error(`${field} must be a string`);
  if (rule === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${field} must be a finite number`);
  if (rule === "boolean" && typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  if (rule === "provider" && !isAssistantProvider(value)) throw new Error(`${field} is not a supported assistant provider`);
  if (rule === "string-array" && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) throw new Error(`${field} must be a list of strings`);
  if (rule === "request-id" && !((typeof value === "string" && value.length > 0) || (typeof value === "number" && Number.isFinite(value)))) throw new Error(`${field} must be a string or finite number`);
  if (rule === "approval-decision" && value !== "accept" && value !== "acceptForSession" && value !== "decline") throw new Error(`${field} is not a supported approval decision`);
  if (rule === "images") {
    if (!Array.isArray(value) || value.some((item) => {
      const image = asRecord(item);
      if (!image) return true;
      const fields = Object.keys(image);
      return fields.some((field) => field !== "name" && field !== "mimeType" && field !== "data") ||
        !Object.hasOwn(image, "name") || typeof image.name !== "string" ||
        !Object.hasOwn(image, "mimeType") || typeof image.mimeType !== "string" ||
        !Object.hasOwn(image, "data") || typeof image.data !== "string";
    })) throw new Error(`${field} must contain valid image attachments`);
  }
  if (rule === "files") {
    try {
      validatePromptFileAttachments(value);
    } catch (error) {
      throw new Error(`${field} must contain valid text file attachments: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Validate untrusted JSON against the typed method contract before daemon dispatch. */
export function parseDaemonApiRequest(method: string, value: unknown): DaemonApiRequest {
  if (!isDaemonApiMethod(method)) throw new Error(`Unsupported daemon request: ${method}`);
  const params = asRecord(value);
  if (!params) throw new Error("Daemon request params must be an object");
  const shape = REQUEST_SHAPES[method];
  const recognizedFields = new Set([...Object.keys(shape.required), ...Object.keys(shape.optional)]);
  for (const field of Object.keys(params)) {
    if (!recognizedFields.has(field)) throw new Error(`${field} is not supported for ${method}`);
  }
  for (const [field, rule] of Object.entries(shape.required)) {
    if (!Object.hasOwn(params, field)) throw new Error(`${field} is required`);
    validateField(params[field], rule, field);
  }
  for (const [field, rule] of Object.entries(shape.optional)) {
    if (Object.hasOwn(params, field)) validateField(params[field], rule, field);
  }
  // The schema is statically checked against each request DTO above, then validated at runtime.
  return { method, params } as DaemonApiRequest;
}
