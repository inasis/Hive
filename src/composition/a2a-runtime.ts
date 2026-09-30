import { randomUUID } from "node:crypto";
import type { AgentAdapter, A2ARuntimeStateStore } from "../application/ports/a2a-runtime.js";
import { A2ARuntime, type A2ARuntimeDependencies } from "../application/use-cases/a2a-runtime.js";
import type { RoutingPolicy } from "../domain/a2a.js";
import type { AssistantEventPublisher } from "../application/ports/events.js";
import { FileA2ARuntimeStateStore } from "../adapters/persistence/a2a-file-state.js";
import { InMemoryA2ARuntimeStateStore } from "../adapters/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../adapters/workspace/a2a-locks.js";
import type { A2AWorkspaceLockPort } from "../application/ports/a2a-runtime.js";

export type A2ARuntimeCompositionOptions = {
  adapters: readonly AgentAdapter[];
  stateStore?: A2ARuntimeStateStore;
  workspaceLocks?: A2AWorkspaceLockPort;
  stateFilePath?: string;
  policy?: Partial<RoutingPolicy>;
  publishAssistantEvent?: AssistantEventPublisher;
};

/** Node composition root; transport and provider adapters are supplied by the host application. */
export function createA2ARuntime(options: A2ARuntimeCompositionOptions): A2ARuntime {
  if (options.stateStore && options.stateFilePath) throw new Error("Choose either stateStore or stateFilePath");
  const dependencies: A2ARuntimeDependencies = {
    adapters: options.adapters,
    stateStore: options.stateStore ?? (options.stateFilePath !== undefined
      ? new FileA2ARuntimeStateStore(options.stateFilePath)
      : new InMemoryA2ARuntimeStateStore()),
    workspaceLocks: options.workspaceLocks ?? new InMemoryA2AWorkspaceLockManager(),
    createId: (kind) => `${kind}-${randomUUID()}`,
    now: () => Date.now(),
    ...(options.publishAssistantEvent ? { publishAssistantEvent: options.publishAssistantEvent } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
  };
  return new A2ARuntime(dependencies);
}
