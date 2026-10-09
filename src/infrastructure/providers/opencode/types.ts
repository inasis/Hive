export type OpenCodeSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  content: string;
  enabled: boolean;
};

export type OpenCodeCommand = {
  name: string;
  description: string;
};

import type { AssistantEventPublisher } from "../../../application/ports/events.js";

export type OpenCodeEventPublisher = AssistantEventPublisher;
