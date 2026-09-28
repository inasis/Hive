export type HiveRelayTarget = {
  host: string;
  port: number;
  pairId: string;
  token: string;
  tls: boolean;
};

export type RelayChannel = "codex" | "terminal" | "files";

export type RelayRole = "agent" | "client";
