import type { Readable, Writable } from "node:stream";

/** Stream and lifecycle contract consumed by the Codex JSON-RPC connection. */
export type CodexRpcTransport = {
  input: Readable;
  output: Writable;
  label: string;
  stderr?: Readable;
  end: () => void;
  terminate: () => void;
  subscribeExit: (listener: (message: string) => void) => void;
};
