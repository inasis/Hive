import type { AssistantModel, AssistantThread } from "../../../domain/assistant.js";
import type { PiRpcProcess } from "./rpc-process.js";

export type JsonObject = Record<string, unknown>;
export type PiEventRecordHandler = (target: string, threadId: () => string, record: JsonObject) => void;

export type PiModel = {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];
  thinkingLevels: string[];
};

export type PiThreadDescriptor = {
  thread: AssistantThread;
  sessionFile: string;
  model?: string;
  sessionName?: string;
};

export type PiOpenSession = PiThreadDescriptor & {
  client: PiRpcProcess;
  effort?: string;
};

export type PiProviderTarget = {
  models: AssistantModel[];
  piModels: Map<string, PiModel>;
  threads: Map<string, PiThreadDescriptor>;
  opened: Map<string, PiOpenSession>;
};
