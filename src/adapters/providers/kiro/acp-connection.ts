import { isValidKiroSessionId, validateKiroPermissionPresets } from "./session-metadata.js";
import { spawnKiroAcp } from "./process.js";
import { KiroAcpRpc } from "./acp-rpc.js";

type JsonObject = Record<string, unknown>;

/** Expose Kiro ACP operations while leaving JSON-RPC framing to KiroAcpRpc. */
export class KiroAcpConnection {
  private constructor(private readonly rpc: KiroAcpRpc) {}

  get isOpen(): boolean {
    return this.rpc.isOpen;
  }

  static async connect(target: string): Promise<KiroAcpConnection> {
    const { child, label } = await spawnKiroAcp(target);
    const connection = new KiroAcpConnection(new KiroAcpRpc(child, label));
    try {
      await connection.rpc.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "hive", title: "Hive", version: "0.1.0" },
      });
      connection.rpc.notify("initialized", {});
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  onSessionUpdate(sessionId: string, listener: Parameters<KiroAcpRpc["onSessionUpdate"]>[1]): () => void {
    return this.rpc.onSessionUpdate(sessionId, listener);
  }

  onServerRequest(listener: Parameters<KiroAcpRpc["onServerRequest"]>[0]): () => void {
    return this.rpc.onServerRequest(listener);
  }

  onNotification(listener: Parameters<KiroAcpRpc["onNotification"]>[0]): () => void {
    return this.rpc.onNotification(listener);
  }

  respond(id: number | string, result: unknown): void {
    this.rpc.respond(id, result);
  }

  respondError(id: number | string, code: number, message: string): void {
    this.rpc.respondError(id, code, message);
  }

  async newSession(cwd: string, policyPresets: string[] = [], mcpServers: JsonObject[] = []): Promise<JsonObject> {
    return asObject(await this.rpc.request("session/new", {
      cwd,
      mcpServers,
      ...(policyPresets.length ? { _meta: { kiro: { policyPreset: validateKiroPermissionPresets(policyPresets) } } } : {}),
    })) ?? {};
  }

  async loadSession(sessionId: string, cwd: string, policyPresets: string[] = [], mcpServers: JsonObject[] = []): Promise<JsonObject> {
    if (!isValidKiroSessionId(sessionId)) throw new Error("Session ID contains unsupported characters");
    return asObject(await this.rpc.request("session/load", {
      sessionId,
      cwd,
      mcpServers,
      ...(policyPresets.length ? { _meta: { kiro: { policyPreset: validateKiroPermissionPresets(policyPresets) } } } : {}),
    }, 120_000)) ?? {};
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.rpc.request("session/set_model", { sessionId, modelId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.rpc.request("session/set_mode", { sessionId, modeId });
  }

  async executeCommand(sessionId: string, command: string, args: JsonObject = {}): Promise<JsonObject> {
    return asObject(await this.rpc.request("_kiro.dev/commands/execute", { sessionId, command: { command, args } })) ?? {};
  }

  async commandOptions(sessionId: string, command: string, partial = ""): Promise<JsonObject[]> {
    const result = asObject(await this.rpc.request("_kiro.dev/commands/options", { sessionId, command: command.replace(/^\/+/, ""), partial }));
    return (Array.isArray(result?.options) ? result.options : []).map(asObject).filter((option): option is JsonObject => Boolean(option));
  }

  startPrompt(sessionId: string, content: JsonObject[], onComplete: (result?: JsonObject, error?: Error) => void): void {
    void this.rpc.request("session/prompt", { sessionId, prompt: content }, 30 * 60_000)
      .then((result) => onComplete(asObject(result) ?? {}), (error: unknown) => onComplete(undefined, asError(error)));
  }

  cancel(sessionId: string): void {
    this.rpc.notify("session/cancel", { sessionId });
  }

  terminate(): void {
    this.rpc.terminate();
  }

  close(): Promise<void> {
    return this.rpc.close();
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
