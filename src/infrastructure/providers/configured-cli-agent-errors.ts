export function adapterFault(code: string, provider: string, message: string, retryable = false): Error & { code: string; provider: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, provider, retryable });
}
