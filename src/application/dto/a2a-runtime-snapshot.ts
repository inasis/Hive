import type {
  A2AAgentHistoryEntryDto,
  A2ACommunicationPermissionsDto,
  A2ATaskRecordDto,
  AgentNode,
  AgentRoom,
  NativeSession,
} from "./a2a-collaboration.js";

export type A2ARuntimeSnapshot = {
  rooms: AgentRoom[];
  agents: AgentNode[];
  sessions: Array<{ agentId: string; session: NativeSession }>;
  histories: Array<{ agentId: string; entries: A2AAgentHistoryEntryDto[] }>;
  tasks: A2ATaskRecordDto[];
  communicationPermissions?: Array<{
    agentId: string;
    permissions: A2ACommunicationPermissionsDto;
  }>;
};
