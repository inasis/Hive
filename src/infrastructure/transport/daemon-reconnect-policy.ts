const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_EXPONENT = 5;

/** Shared retry timing and terminal credential-error policy for daemon clients. */
export class DaemonReconnectPolicy {
  private attempt = 0;

  nextDelayMs(): number {
    const delay = Math.min(MAX_RETRY_DELAY_MS, INITIAL_RETRY_DELAY_MS * 2 ** Math.min(this.attempt, MAX_RETRY_EXPONENT));
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }

  isCredentialFailure(message: string): boolean {
    return /페어링 토큰|pairing token|(?:인증서|certificate|fingerprint).*(?:일치하지 않습니다|mismatch|invalid|does not match|doesn't match)/i.test(message);
  }
}
