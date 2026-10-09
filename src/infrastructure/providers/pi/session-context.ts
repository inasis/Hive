import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AssistantThread } from "../../../domain/assistant.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";
import { ensurePiA2AExtension } from "./a2a-tools.js";
import type { PiRpcProcess } from "./rpc-process.js";
import { createPiRpcProcess } from "./rpc-process-factory.js";
import { listPiSessions } from "./session-files.js";
import { modelKey, toAssistantModel } from "./model-catalog.js";
import { discoverPiModels } from "./model-discovery.js";
import type { JsonObject, PiOpenSession, PiProviderTarget } from "./session-types.js";
import { PiSessionThreadLifecycle } from "./session-thread-lifecycle.js";

const DEFAULT_PI_COMMAND = "pi";

/** Owns Pi RPC clients and the isolated Hive session directory for the local host. */
export class PiSessionContext {
  private readonly targets = new Map<string, PiProviderTarget>();
  private readonly connecting = new Map<string, Promise<PiProviderTarget>>();
  private readonly threadLifecycle: PiSessionThreadLifecycle;
  private a2aExtensionPath: string | undefined;
  readonly sessionDirectory = resolve(
    process.env.HIVE_PI_SESSION_DIR?.trim() || join(homedir(), ".pi", "agent", "sessions", "hive"),
  );
  readonly command = process.env.HIVE_PI_BIN?.trim() || DEFAULT_PI_COMMAND;

  constructor() {
    this.threadLifecycle = new PiSessionThreadLifecycle({
      sessionDirectory: this.sessionDirectory,
      createRpc: (...args) => this.createRpc(...args),
    });
  }

  async getOrConnect(target: string): Promise<PiProviderTarget> {
    assertLocalTarget(target);
    const existing = this.targets.get(target);
    if (existing) return existing;
    const pending = this.connecting.get(target);
    if (pending) return pending;
    const task = this.initializeTarget();
    this.connecting.set(target, task);
    try {
      const state = await task;
      this.targets.set(target, state);
      return state;
    } finally {
      this.connecting.delete(target);
    }
  }

  require(target: string): PiProviderTarget {
    assertLocalTarget(target);
    const state = this.targets.get(target);
    if (!state) throw new Error("Pi 연결이 만료되었습니다. 연결 설정에서 다시 연결하세요.");
    return state;
  }

  async open(target: string, threadId: string, onRecord?: (record: JsonObject) => void): Promise<PiOpenSession> {
    const state = await this.getOrConnect(target);
    return this.threadLifecycle.open(state, threadId, onRecord);
  }

  async startNew(
    target: string,
    cwd: string,
    model: string,
    sessionName?: string,
    onRecord?: (record: JsonObject) => void,
    callerAgentId?: string,
  ): Promise<PiOpenSession> {
    const state = await this.getOrConnect(target);
    return this.threadLifecycle.startNew(state, cwd, model, sessionName, onRecord, callerAgentId);
  }

  async duplicateForFork(
    target: string,
    threadId: string,
    entryId: string | undefined,
    onRecord?: (record: JsonObject) => void,
  ): Promise<PiOpenSession> {
    const source = await this.open(target, threadId);
    const state = this.require(target);
    return this.threadLifecycle.duplicateForFork(state, source, entryId, onRecord);
  }

  async disconnect(target: string): Promise<void> {
    const state = this.targets.get(target);
    if (!state) return;
    this.targets.delete(target);
    await Promise.all([...state.opened.values()].map((session) => session.client.close()));
    state.opened.clear();
  }

  async closeAll(): Promise<void> {
    for (const target of this.targets.keys()) await this.disconnect(target);
  }

  terminateAll(): void {
    for (const state of this.targets.values()) {
      for (const session of state.opened.values()) session.client.terminate();
    }
  }

  defaultModel(target: string): string | undefined {
    const state = this.require(target);
    return state.models.find((item) => !item.hidden)?.model;
  }

  async refresh(target: string): Promise<AssistantThread[]> {
    const state = await this.getOrConnect(target);
    const descriptors = await listPiSessions(this.sessionDirectory);
    state.threads.clear();
    for (const descriptor of descriptors) state.threads.set(descriptor.thread.id, descriptor);
    for (const [threadId, session] of state.opened) state.threads.set(threadId, session);
    return [...state.threads.values()]
      .map(({ thread }) => thread)
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
  }

  createRpc(
    cwd: string,
    sessionFile?: string,
    onRecord?: (record: JsonObject) => void,
    initialModel?: string,
    noSession = false,
    providerId?: string,
    callerAgentId?: string,
  ): PiRpcProcess {
    return createPiRpcProcess({
      command: this.command,
      sessionDirectory: this.sessionDirectory,
      cwd,
      ...(sessionFile ? { sessionFile } : {}),
      ...(onRecord ? { onRecord } : {}),
      ...(initialModel ? { initialModel } : {}),
      noSession,
      ...(providerId !== undefined ? { providerId } : {}),
      ...(this.a2aExtensionPath ? { a2aExtensionPath: this.a2aExtensionPath } : {}),
      ...(callerAgentId ? { callerAgentId } : {}),
    });
  }

  private async initializeTarget(): Promise<PiProviderTarget> {
    await mkdir(this.sessionDirectory, { recursive: true, mode: 0o700 });
    this.a2aExtensionPath = await ensurePiA2AExtension(this.sessionDirectory);
    const { models: selected, defaultModel } = await discoverPiModels(
      this.createRpc(process.cwd(), undefined, undefined, undefined, true),
    );
    if (!selected.length) {
      throw new Error("Pi did not return any configured models. Add a provider/model to ~/.pi/agent/models.json and check its API key.");
    }
    const firstSelected = selected[0];
    if (!firstSelected) throw new Error("Pi did not return any configured models.");
    const resolvedDefaultModel = defaultModel && selected.some((model) => modelKey(model.provider, model.id) === defaultModel)
      ? defaultModel
      : modelKey(firstSelected.provider, firstSelected.id);
    const models = selected.map((model) => toAssistantModel(model, modelKey(model.provider, model.id) === resolvedDefaultModel));
    const state: PiProviderTarget = {
      models,
      piModels: new Map(selected.map((model) => [modelKey(model.provider, model.id), model])),
      threads: new Map(),
      opened: new Map(),
    };
    for (const descriptor of await listPiSessions(this.sessionDirectory)) {
      state.threads.set(descriptor.thread.id, descriptor);
    }
    return state;
  }

}

function assertLocalTarget(target: string): void {
  if (target !== LOCAL_WORKSPACE_TARGET) throw new Error("Pi CLI는 현재 Hive 실행 host의 로컬 작업공간에서만 지원됩니다.");
}

function timestamp(value: string | number | null): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
