import { useCallback, useRef, useState } from "react";
import type { PreferencesPort } from "../../shared/preferences";
import { createPersonaProfile, createPersonaSpace, readPersonaConfiguration, savePersonaConfiguration, type PersonaConfiguration, type PersonaProfile, type PersonaSpace } from "../../shared/persona-profiles";

/** Keep persona selection and edits shared between the sidebar and editor page. */
export function usePersonaProfiles(preferences: PreferencesPort) {
  const [configuration, setConfiguration] = useState(() => readPersonaConfiguration(preferences));
  const configurationRef = useRef(configuration);

  const updateConfiguration = useCallback((update: (current: PersonaConfiguration) => PersonaConfiguration) => {
    const next = update(configurationRef.current);
    configurationRef.current = next;
    savePersonaConfiguration(preferences, next);
    setConfiguration(next);
  }, [preferences]);

  const addSpace = useCallback(() => {
    const id = createPersonaId("space");
    updateConfiguration((current) => {
      const space = createPersonaSpace(id, `새 역할 공간 ${current.spaces.length + 1}`);
      return { ...current, spaces: [...current.spaces, space], activeSpaceId: id };
    });
  }, [updateConfiguration]);

  const selectSpace = useCallback((id: string) => {
    updateConfiguration((current) => current.spaces.some((space) => space.id === id)
      ? { ...current, activeSpaceId: id }
      : current,
    );
  }, [updateConfiguration]);

  const updateSpace = useCallback((id: string, update: Partial<Omit<PersonaSpace, "id" | "profiles">>) => {
    updateConfiguration((current) => ({
      ...current,
      spaces: current.spaces.map((space) => space.id === id ? { ...space, ...update } : space),
    }));
  }, [updateConfiguration]);

  const deleteSpace = useCallback((id: string) => {
    updateConfiguration((current) => {
      const target = current.spaces.find((space) => space.id === id);
      if (!target || target.profiles.length > 0) return current;
      const spaces = current.spaces.filter((space) => space.id !== id);
      const profiles = spaces.flatMap((space) => space.profiles);
      const activeProfileId = profiles.some((profile) => profile.id === current.activeProfileId)
        ? current.activeProfileId
        : profiles[0]?.id ?? null;
      const activeProfileSpaceId = spaces.find((space) => space.profiles.some((profile) => profile.id === activeProfileId))?.id ?? null;
      const activeSpaceId = current.activeSpaceId === id
        ? activeProfileSpaceId ?? spaces[0]?.id ?? null
        : current.activeSpaceId;
      return { spaces, activeSpaceId, activeProfileId };
    });
  }, [updateConfiguration]);

  const addProfile = useCallback((spaceId: string) => {
    const id = createPersonaId();
    updateConfiguration((current) => {
      const space = current.spaces.find((candidate) => candidate.id === spaceId);
      if (!space) return current;
      const profile = createPersonaProfile(id, `새 페르소나 ${space.profiles.length + 1}`);
      return {
        ...current,
        spaces: current.spaces.map((candidate) => candidate.id === spaceId ? { ...candidate, profiles: [...candidate.profiles, profile] } : candidate),
        activeSpaceId: spaceId,
        activeProfileId: profile.id,
      };
    });
    return id;
  }, [updateConfiguration]);

  const selectProfile = useCallback((id: string) => {
    updateConfiguration((current) => {
      const space = current.spaces.find((candidate) => candidate.profiles.some((profile) => profile.id === id));
      return space ? { ...current, activeSpaceId: space.id, activeProfileId: id } : current;
    });
  }, [updateConfiguration]);

  const updateProfile = useCallback((id: string, update: Partial<Omit<PersonaProfile, "id">>) => {
    updateConfiguration((current) => ({
      ...current,
      spaces: current.spaces.map((space) => ({
        ...space,
        profiles: space.profiles.map((profile) => profile.id === id ? { ...profile, ...update } : profile),
      })),
    }));
  }, [updateConfiguration]);

  const deleteProfile = useCallback((id: string) => {
    updateConfiguration((current) => {
      const spaces = current.spaces.map((space) => ({
        ...space,
        profiles: space.profiles.filter((profile) => profile.id !== id),
      }));
      const profiles = spaces.flatMap((space) => space.profiles);
      const activeProfileId = current.activeProfileId === id
        ? profiles[0]?.id ?? null
        : current.activeProfileId;
      const activeSpaceId = current.activeProfileId === id
        ? spaces.find((space) => space.profiles.some((profile) => profile.id === activeProfileId))?.id ?? current.activeSpaceId
        : current.activeSpaceId;
      return { ...current, spaces, activeSpaceId, activeProfileId };
    });
  }, [updateConfiguration]);

  return { configuration, addSpace, selectSpace, updateSpace, deleteSpace, addProfile, selectProfile, updateProfile, deleteProfile };
}

function createPersonaId(prefix = "persona"): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
