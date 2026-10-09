/** Application contract for rendering an agent-authored request or result in a transcript. */
export type A2ACommunicationSummaryItemDto = {
  kind: "request" | "result";
  taskId: string;
  sourceAgentId: string;
  sourceSessionName?: string;
  /** Creation time of the A2A task, in milliseconds since the Unix epoch. */
  createdAt?: number;
  message: string;
};
