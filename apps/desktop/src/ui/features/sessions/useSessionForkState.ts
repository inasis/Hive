import { useEffect, useState } from "react";
import { assistantProviderSupports, isAssistantProvider } from "../../../../../../src/domain/provider-catalog.js";
import { preferences } from "../../bridgeClient";
import { PREFERENCE_KEYS } from "../../../shared/preferences";
import type { SideChatTab } from "../conversation/session-state";

export function useSessionForkState() {
  const [activeSideChatId, setActiveSideChatId] = useState("");
  const [sideChats, setSideChats] = useState<SideChatTab[]>(readPersistentForkTabs);

  useEffect(() => {
    try {
      preferences.setItem(PREFERENCE_KEYS.persistentForkTabs, JSON.stringify(sideChats.filter((chat) => chat.persistent)));
    } catch {}
  }, [sideChats]);

  return {
    state: { activeSideChatId, sideChats },
    setters: { setActiveSideChatId, setSideChats },
  };
}

function readPersistentForkTabs(): SideChatTab[] {
  try {
    const value: unknown = JSON.parse(preferences.getItem(PREFERENCE_KEYS.persistentForkTabs) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SideChatTab[] => {
      if (!item || typeof item !== "object") return [];
      const tab = item as Partial<SideChatTab>;
      if (tab.persistent !== true || typeof tab.target !== "string" || typeof tab.threadId !== "string" ||
          !isAssistantProvider(tab.provider) || !assistantProviderSupports(tab.provider, "forks") ||
          typeof tab.parentThreadId !== "string" ||
          typeof tab.rootThreadId !== "string" || typeof tab.label !== "string") return [];
      return [{ ...tab, persistent: true } as SideChatTab];
    });
  } catch {
    return [];
  }
}
