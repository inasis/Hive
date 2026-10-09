import { parseCodexRpcEnvelope, type CodexRpcEnvelope } from "./codex-rpc-envelope.js";
import { CodexRpcError } from "./codex-rpc-error.js";
import { CodexRpcPendingRequests } from "./codex-rpc-pending-requests.js";

/** Routes decoded app-server notifications and responses to their direct consumers. */
export class CodexRpcMessageRouter {
  private readonly listeners = new Set<
    (method: string, params: unknown, requestId?: number | string) => void
  >();

  constructor(
    private readonly pendingRequests: CodexRpcPendingRequests,
    private readonly terminateTransport: () => void,
  ) {}

  onNotification(listener: (method: string, params: unknown, requestId?: number | string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  receiveLine(line: string): void {
    if (!line.trim()) return;

    let message: CodexRpcEnvelope | undefined;
    try {
      message = parseCodexRpcEnvelope(JSON.parse(line) as unknown);
    } catch {
      message = undefined;
    }
    if (!message) {
      this.pendingRequests.rejectAll(new Error("Codex app-server returned an invalid JSON-RPC message"));
      this.terminateTransport();
      return;
    }

    if (message.method) {
      for (const listener of this.listeners) {
        listener(message.method, message.params, message.id);
      }
      return;
    }

    if (message.id === undefined) return;
    const id = typeof message.id === "number" ? message.id : Number(message.id);
    if (message.error) {
      this.pendingRequests.reject(id,
        new CodexRpcError(
          message.error.message ?? "Codex app-server returned an RPC error",
          message.error.code,
          message.error.data,
        ),
      );
      return;
    }

    this.pendingRequests.resolve(id, message.result);
  }
}
