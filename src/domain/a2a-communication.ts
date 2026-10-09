/** Domain representation of an agent-authored request or result in the transcript model. */
export type A2ACommunicationSummaryItem = {
  kind: "request" | "result";
  taskId: string;
  sourceAgentId: string;
  sourceSessionName?: string;
  /** Creation time of the A2A task, in milliseconds since the Unix epoch. */
  createdAt?: number;
  message: string;
};
