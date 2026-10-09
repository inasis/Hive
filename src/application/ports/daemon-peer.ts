/** Minimal bidirectional peer operations required by the daemon RPC server. */
export interface DaemonPeer {
  onMessage(listener: (text: string) => void | Promise<void>): void;
  onClose(listener: () => void): void;
  send(value: unknown): void;
  close(code: number, reason: string): void;
}
