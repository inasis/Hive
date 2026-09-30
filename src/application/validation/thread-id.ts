/** Validate thread identifiers accepted by provider-facing application operations. */
export function validateThreadId(threadId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new Error("Thread ID contains unsupported characters");
}
