import type { RemoteCommand, RemoteSkill } from "./bridge";

export type SlashMenuItem = { kind: "skill"; skill: RemoteSkill } | { kind: "command"; command: RemoteCommand };
