import type { StartTerminalInput, TerminalPort } from "../ports/terminal.js";

/** Own terminal actions exposed to interfaces while the adapter owns PTY resources. */
export class TerminalUseCases {
  constructor(private readonly terminal: TerminalPort) {}

  start(input: StartTerminalInput): Promise<void> {
    return this.terminal.start(input);
  }

  input(target: string, sessionId: string, data: string): void {
    this.terminal.input(target, sessionId, data);
  }

  resize(target: string, sessionId: string, cols: number, rows: number): void {
    this.terminal.resize(target, sessionId, cols, rows);
  }

  stop(target: string, sessionId: string): void {
    this.terminal.stop(target, sessionId);
  }

  stopForTarget(target: string): void {
    this.terminal.stopTarget(target);
  }
}
