/** Tracks async request acknowledgements that temporarily reserve an agent. */
export class A2APendingAsyncRequests {
  private readonly counts = new Map<string, number>();

  has(agentId: string): boolean {
    return this.counts.has(agentId);
  }

  track(agentId: string): () => void {
    this.counts.set(agentId, (this.counts.get(agentId) ?? 0) + 1);
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      const count = (this.counts.get(agentId) ?? 1) - 1;
      if (count > 0) this.counts.set(agentId, count);
      else this.counts.delete(agentId);
    };
  }
}
