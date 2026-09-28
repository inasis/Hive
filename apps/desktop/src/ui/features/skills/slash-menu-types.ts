import type { RemoteCommand, RemoteSkill } from "../../../shared/bridge";

export type SlashMenuItem = { kind: "skill"; skill: RemoteSkill } | { kind: "command"; command: RemoteCommand };
