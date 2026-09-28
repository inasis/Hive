export type TerminalEventPayload =
  | { type: "data"; data: string }
  | { type: "ready"; cwd: string }
  | { type: "error"; message: string }
  | { type: "exit"; exitCode: number | null; signal: number | null };

export type TerminalEvent = TerminalEventPayload & {
  target: string;
  sessionId: string;
};

export type StartTerminalInput = {
  target: string;
  cwd: string;
  sessionId: string;
  cols: number;
  rows: number;
};

export interface TerminalPort {
  start(input: StartTerminalInput): Promise<void>;
  input(target: string, sessionId: string, data: string): void;
  resize(target: string, sessionId: string, cols: number, rows: number): void;
  stop(target: string, sessionId: string): void;
  stopTarget(target: string): void;
}

export type TerminalEventSink = (event: TerminalEvent) => void;
