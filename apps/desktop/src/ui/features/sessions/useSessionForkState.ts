import { useEffect, useState } from "react";
import { assistantProviderSupports, isAssistantProvider } from "../../../../../../src/domain/provider-catalog.js";
import { preferences } from "../../bridgeClient";
import { PREFERENCE_KEYS } from "../../../shared/preferences";
import type { SideChatTab } from "../../shared/conversation-view";

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
      if (!isRecord(item)) return [];
      const tab = item;
      if (tab.persistent !== true || typeof tab.target !== "string" || typeof tab.threadId !== "string" ||
          !isAssistantProvider(tab.provider) || !assistantProviderSupports(tab.provider, "forks") ||
          typeof tab.parentThreadId !== "string" ||
          typeof tab.rootThreadId !== "string" || typeof tab.label !== "string") return [];
      return [{
        target: tab.target,
        threadId: tab.threadId,
        provider: tab.provider,
        parentThreadId: tab.parentThreadId,
        rootThreadId: tab.rootThreadId,
        label: tab.label,
        persistent: true,
      }];
    });
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
