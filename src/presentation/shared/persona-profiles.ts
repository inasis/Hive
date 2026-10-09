import type { A2ACommunicationPermissionsDto } from "../../application/dto/a2a-collaboration.js";
import type { AgentContextDto, AgentDefinitionDto } from "../../application/dto/prompt.js";
import { hasAgentContextContent } from "../../domain/agent-context.js";
import { PREFERENCE_KEYS, type PreferencesPort } from "./preferences";

type LegacyDefinitionSettings = {
  identity?: string;
  mission?: string;
  expertise?: string;
  reasoningPolicy?: string;
  behavioralPolicy?: string;
  workflow?: string;
  outputStyle?: string;
  boundaries?: string;
  successCriteria?: string;
  toolInstructions?: string;
};

/** Extra properties preserve preferences written by the earlier, more detailed editor. */
export type PersonaProfile = AgentDefinitionDto & LegacyDefinitionSettings;

export type PersonaSpacePermissions = A2ACommunicationPermissionsDto;

export type PersonaSpace = {
  id: string;
  name: string;
  permissions: PersonaSpacePermissions;
  profiles: PersonaProfile[];
};

export type PersonaConfiguration = {
  spaces: PersonaSpace[];
  activeSpaceId: string | null;
  activeProfileId: string | null;
};

const DEFAULT_SPACE_PERMISSIONS: PersonaSpacePermissions = { a2a: false, a2b: false };
const LEGACY_SPACE_PERMISSIONS: PersonaSpacePermissions = { a2a: true, a2b: true };
const LEGACY_SPACE_ID = "default-role-space";

const LEGACY_FIELDS = [
  "identity",
  "mission",
  "expertise",
  "reasoningPolicy",
  "behavioralPolicy",
  "workflow",
  "outputStyle",
  "boundaries",
  "successCriteria",
  "toolInstructions",
] as const satisfies ReadonlyArray<keyof LegacyDefinitionSettings>;

export function createPersonaProfile(id: string, name: string): PersonaProfile {
  return { id, name, role: "", personality: "", persona: "", instructions: "" };
}

export function createPersonaSpace(id: string, name: string): PersonaSpace {
  return { id, name, permissions: { ...DEFAULT_SPACE_PERMISSIONS }, profiles: [] };
}

export function readPersonaConfiguration(preferences: PreferencesPort): PersonaConfiguration {
  const stored = preferences.getItem(PREFERENCE_KEYS.personaProfiles) ?? preferences.getItem(PREFERENCE_KEYS.personaProfilesLegacy);
  if (stored !== null) {
    try {
      const value: unknown = JSON.parse(stored);
      if (isRecord(value)) {
        if (Array.isArray(value.spaces)) return parsePersonaSpaces(value);
        if (Array.isArray(value.profiles)) {
          const profiles = parseProfiles(value.profiles);
          const activeProfileId = typeof value.activeProfileId === "string" && profiles.some((profile) => profile.id === value.activeProfileId)
            ? value.activeProfileId
            : profiles[0]?.id ?? null;
          const space = createPersonaSpace(LEGACY_SPACE_ID, "기본 역할 공간");
          space.permissions = { ...LEGACY_SPACE_PERMISSIONS };
          space.profiles = profiles;
          return { spaces: profiles.length ? [space] : [], activeSpaceId: profiles.length ? space.id : null, activeProfileId };
        }
      }
    } catch {
      // Fall through to the legacy single-profile preferences below.
    }
  }

  const personality = preferences.getItem(PREFERENCE_KEYS.personaPersonality) ?? "";
  const persona = preferences.getItem(PREFERENCE_KEYS.personaDescription) ?? "";
  if (!personality.trim() && !persona.trim()) return { spaces: [], activeSpaceId: null, activeProfileId: null };

  const legacyProfile = createPersonaProfile("legacy-default", "기본 페르소나");
  legacyProfile.personality = personality;
  legacyProfile.persona = persona;
  const space = createPersonaSpace(LEGACY_SPACE_ID, "기본 역할 공간");
  space.permissions = { ...LEGACY_SPACE_PERMISSIONS };
  space.profiles = [legacyProfile];
  return { spaces: [space], activeSpaceId: space.id, activeProfileId: legacyProfile.id };
}

export function savePersonaConfiguration(preferences: PreferencesPort, configuration: PersonaConfiguration): void {
  preferences.setItem(PREFERENCE_KEYS.personaProfiles, JSON.stringify(configuration));
}

export function readActiveAgentContext(preferences: PreferencesPort): AgentContextDto | undefined {
  const configuration = readPersonaConfiguration(preferences);
  const profile = configuration.spaces.flatMap((space) => space.profiles)
    .find((candidate) => candidate.id === configuration.activeProfileId);
  const profileSpace = profile
    ? configuration.spaces.find((space) => space.profiles.some((candidate) => candidate.id === profile.id))
    : undefined;
  const space = profileSpace ?? configuration.spaces.find((candidate) => candidate.id === configuration.activeSpaceId);
  const definition: AgentDefinitionDto | undefined = profile ? {
    id: profile.id,
    name: profile.name,
    role: profile.role,
    personality: profile.personality,
    persona: profile.persona,
    instructions: profile.instructions,
  } : undefined;
  const context: AgentContextDto = {
    ...(definition ? { definition } : {}),
    ...(space ? { communicationPermissions: { ...space.permissions } } : {}),
  };
  return (definition && hasAgentContextContent({ definition })) || space ? context : undefined;
}

function parsePersonaSpaces(value: Record<string, unknown>): PersonaConfiguration {
  const storedSpaces = Array.isArray(value.spaces) ? value.spaces : [];
  const spaces = storedSpaces.flatMap((space): PersonaSpace[] => {
    if (!isRecord(space) || typeof space.id !== "string" || typeof space.name !== "string" || !Array.isArray(space.profiles)) return [];
    const parsed = createPersonaSpace(space.id, space.name);
    parsed.profiles = parseProfiles(space.profiles);
    if (isRecord(space.permissions)) {
      parsed.permissions = {
        a2a: typeof space.permissions.a2a === "boolean" ? space.permissions.a2a : false,
        a2b: typeof space.permissions.a2b === "boolean" ? space.permissions.a2b : false,
      };
    }
    return [parsed];
  });
  const profiles = spaces.flatMap((space) => space.profiles);
  const activeProfileId = typeof value.activeProfileId === "string" && profiles.some((profile) => profile.id === value.activeProfileId)
    ? value.activeProfileId
    : profiles[0]?.id ?? null;
  const activeSpaceId = typeof value.activeSpaceId === "string" && spaces.some((space) => space.id === value.activeSpaceId)
    ? value.activeSpaceId
    : spaces.find((space) => space.profiles.some((profile) => profile.id === activeProfileId))?.id ?? spaces[0]?.id ?? null;
  return { spaces, activeSpaceId, activeProfileId };
}

function parseProfiles(values: unknown[]): PersonaProfile[] {
  return values.flatMap((profile) => {
    const parsed = parsePersonaProfile(profile);
    return parsed ? [parsed] : [];
  });
}

function parsePersonaProfile(value: unknown): PersonaProfile | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const profile = createPersonaProfile(value.id, value.name);
  const previousRole = ["identity", "role", "mission", "expertise"]
    .flatMap((field) => typeof value[field] === "string" && value[field].trim() ? [value[field].trim()] : [])
    .join("\n");
  profile.role = typeof value.role === "string" && value.role.trim() ? value.role : previousRole;
  profile.personality = typeof value.personality === "string" ? value.personality : "";
  profile.persona = typeof value.persona === "string" ? value.persona : "";
  profile.instructions = typeof value.instructions === "string" ? value.instructions : "";
  for (const field of LEGACY_FIELDS) {
    if (typeof value[field] === "string") profile[field] = value[field];
  }
  return profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
