import { useEffect, useState } from "react";
import { assistantProviderSupports, isAssistantProvider } from "../../../domain/provider-catalog.js";
import { PREFERENCE_KEYS, type PreferencesPort } from "../../shared/preferences";
import type { SideChatTab } from "../../shared/conversation-view";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

export function useSessionForkState() {
  const { bridge } = useDesktopUiRuntime();
  const [activeSideChatId, setActiveSideChatId] = useState("");
  const [sideChats, setSideChats] = useState<SideChatTab[]>(() => readPersistentForkTabs(bridge.preferences));

  useEffect(() => {
    try {
      bridge.preferences.setItem(PREFERENCE_KEYS.persistentForkTabs, JSON.stringify(sideChats.filter((chat) => chat.persistent)));
    } catch {}
  }, [bridge, sideChats]);

  return {
    state: { activeSideChatId, sideChats },
    setters: { setActiveSideChatId, setSideChats },
  };
}

function readPersistentForkTabs(preferences: PreferencesPort): SideChatTab[] {
  try {
    const value: unknown = JSON.parse(preferences.getItem(PREFERENCE_KEYS.persistentForkTabs) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SideChatTab[] => {
      if (!isRecord(item)) return [];
      const tab = item;
      if (tab.persistent !== true || typeof tab.target !== "string" || typeof tab.threadId !== "string" ||
          !isAssistantProvider(tab.provider) || (tab.kind !== "session" && !assistantProviderSupports(tab.provider, "forks")) ||
          typeof tab.parentThreadId !== "string" ||
          typeof tab.rootThreadId !== "string" || typeof tab.label !== "string" ||
          (tab.kind !== undefined && tab.kind !== "session" && tab.kind !== "fork")) return [];
      return [{
        target: tab.target,
        threadId: tab.threadId,
        provider: tab.provider,
        parentThreadId: tab.parentThreadId,
        rootThreadId: tab.rootThreadId,
        label: tab.label,
        persistent: true,
        kind: tab.kind === "session" ? "session" : "fork",
      }];
    });
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
