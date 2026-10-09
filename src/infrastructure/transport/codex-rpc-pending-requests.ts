type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Correlates Codex RPC request IDs with their timeout and settlement lifecycle. */
export class CodexRpcPendingRequests {
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;

  register(
    method: string,
    timeoutMs: number,
    resolve: (value: unknown) => void,
    reject: (error: Error) => void,
  ): number {
    const id = this.nextId++;
    const timer = setTimeout(() => {
      const request = this.take(id);
      request?.reject(new Error(`Codex request timed out: ${method}`));
    }, timeoutMs);
    this.pending.set(id, { resolve, reject, timer });
    return id;
  }

  resolve(id: number, value: unknown): boolean {
    const request = this.take(id);
    if (!request) return false;
    request.resolve(value);
    return true;
  }

  reject(id: number, error: Error): boolean {
    const request = this.take(id);
    if (!request) return false;
    request.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private take(id: number): PendingRequest | undefined {
    const request = this.pending.get(id);
    if (!request) return undefined;
    clearTimeout(request.timer);
    this.pending.delete(id);
    return request;
  }
}
