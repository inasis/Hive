import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";

export type RelayRole = "agent" | "client";
export type RelaySocket = Socket | TLSSocket;
export type RelayDirectionKeys = {
  sendKey: Buffer;
  receiveKey: Buffer;
  sendLabel: string;
  receiveLabel: string;
  confirmKey: Buffer;
};
