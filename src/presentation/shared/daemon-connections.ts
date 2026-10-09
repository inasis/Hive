import type { AssistantThreadDto } from "../../application/dto/assistant.js";

export type DaemonConnectionCredentials = {
  endpoint: string;
  token: string;
  fingerprint: string;
};

export type DaemonConnection = {
  id: string;
  target: string;
  endpoint: string;
  hostname: string;
  state: "disconnected" | "connecting" | "connected";
  error: string;
  threads: AssistantThreadDto[];
};

/** Desktop UI contract for managing saved daemon connections. */
export interface DaemonConnectionsPort {
  snapshot(): DaemonConnection[];
  subscribe(listener: () => void): () => void;
  start(): void;
  add(credentials: DaemonConnectionCredentials): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(id: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  updateThreads(target: string, threads: AssistantThreadDto[]): void;
}
