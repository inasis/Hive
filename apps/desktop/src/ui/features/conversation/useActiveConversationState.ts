import { useEffect, useState } from "react";
import type { AssistantProvider, RemoteCommand, RemoteMode, RemoteSkill, TranscriptEntry } from "../../../shared/bridge";

export function useActiveConversationState() {
  const [activeThreadId, setActiveThreadId] = useState("");
  const [activeThreadProvider, setActiveThreadProvider] = useState<AssistantProvider | null>(null);
  const [activeTitle, setActiveTitle] = useState("");
  const [activeCwd, setActiveCwd] = useState("");
  const [currentModel, setCurrentModel] = useState("");
  const [modelSettingsDialogOpen, setModelSettingsDialogOpen] = useState(false);
  const [currentEffort, setCurrentEffort] = useState<string | null>(null);
  const [currentPermissionProfile, setCurrentPermissionProfile] = useState<string | null>(null);
  const [currentModes, setCurrentModes] = useState<RemoteMode[]>([]);
  const [currentModeId, setCurrentModeId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [skills, setSkills] = useState<RemoteSkill[]>([]);
  const [skillWarnings, setSkillWarnings] = useState<string[]>([]);
  const [slashCommands, setSlashCommands] = useState<RemoteCommand[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<RemoteSkill | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState("");
  const [stoppingTurn, setStoppingTurn] = useState(false);
  const [steeringPrompt, setSteeringPrompt] = useState(false);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [busyElapsed, setBusyElapsed] = useState(0);

  useEffect(() => {
    if (busySince === null) {
      setBusyElapsed(0);
      return;
    }
    const updateElapsed = () => setBusyElapsed(Math.floor((Date.now() - busySince) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [busySince]);

  return {
    state: {
      activeThreadId,
      activeThreadProvider,
      activeTitle,
      activeCwd,
      currentModel,
      modelSettingsDialogOpen,
      currentEffort,
      currentPermissionProfile,
      currentModes,
      currentModeId,
      entries,
      skills,
      skillWarnings,
      slashCommands,
      selectedSkill,
      draft,
      busy,
      activeTurnId,
      stoppingTurn,
      steeringPrompt,
      busySince,
      busyElapsed,
    },
    setters: {
      setActiveThreadId,
      setActiveThreadProvider,
      setActiveTitle,
      setActiveCwd,
      setCurrentModel,
      setModelSettingsDialogOpen,
      setCurrentEffort,
      setCurrentPermissionProfile,
      setCurrentModes,
      setCurrentModeId,
      setEntries,
      setSkills,
      setSkillWarnings,
      setSlashCommands,
      setSelectedSkill,
      setDraft,
      setBusy,
      setActiveTurnId,
      setStoppingTurn,
      setSteeringPrompt,
      setBusySince,
    },
  };
}
