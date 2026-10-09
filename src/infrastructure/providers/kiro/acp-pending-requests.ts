/** Correlate Kiro ACP replies with timed provider requests. */
export class KiroAcpPendingRequests {
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private nextId = 1;

  request(method: string, timeoutMs: number, send: (id: number) => void): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Kiro ACP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        send(id);
      } catch (error) {
        this.finish(id);
        reject(asError(error));
      }
    });
  }

  receive(id: number, result: unknown, error?: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.finish(id);
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private finish(id: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
