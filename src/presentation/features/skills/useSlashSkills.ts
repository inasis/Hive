import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantProvider, RemoteCommand, RemoteSkill } from "../../shared/bridge";
import type { SlashMenuItem } from "../../shared/slash-menu";
import type { ThreadViewStorePort } from "../../shared/conversation-store";
import type { AppPage } from "../../shared/workspace-state";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SlashSkillsOptions = {
  state: {
    connectedTarget: string;
    activeThreadId: string;
    cwd: string;
    provider: AssistantProvider;
    activePage: AppPage;
    activeTab: "chat" | "terminal" | `file:${string}`;
    draft: string;
    skills: RemoteSkill[];
    slashCommands: RemoteCommand[];
  };
  refs: {
    threadViews: ThreadViewStorePort;
  };
  setters: {
    setSkills: StateSetter<RemoteSkill[]>;
    setSlashCommands: StateSetter<RemoteCommand[]>;
    setSkillWarnings: StateSetter<string[]>;
    setSelectedSkill: StateSetter<RemoteSkill | null>;
    setDraft: StateSetter<string>;
  };
  actions: {
    isThreadSelected(target: string, provider: AssistantProvider, threadId: string): boolean;
  };
};

/** Own skill/command discovery for the slash menu and the menu selection actions. */
export function useSlashSkills({ state, refs, setters, actions }: SlashSkillsOptions) {
  const { bridge } = useDesktopUiRuntime();
  const refreshSequence = useRef(0);
  const [slashSkillLoading, setSlashSkillLoading] = useState(false);
  const [slashSkillIndex, setSlashSkillIndex] = useState(0);
  const slashMenuOpen = state.activePage === "sessions" && state.activeTab === "chat" && Boolean(state.activeThreadId) &&
    state.draft.startsWith("/") && !/\s/.test(state.draft);
  const slashSkillQuery = state.draft.replace(/^\/+/, "").toLowerCase();
  const visibleSlashSkills = state.skills.filter((skill) => skill.enabled &&
    `${skill.name} ${skill.description} ${skill.provider} ${skill.scope} ${skill.id}`.toLowerCase().includes(slashSkillQuery),
  );
  const visibleSlashCommands = state.slashCommands.filter((command) =>
    `${command.name} /${command.name} ${command.description} ${command.provider}`.toLowerCase().includes(slashSkillQuery),
  );
  const visibleSlashItems: SlashMenuItem[] = [
    ...visibleSlashCommands.map((command): SlashMenuItem => ({ kind: "command", command })),
    ...visibleSlashSkills.map((skill): SlashMenuItem => ({ kind: "skill", skill })),
  ];

  useEffect(() => setSlashSkillIndex(0), [slashSkillQuery, state.activeThreadId]);

  const refreshSlashSkills = async (): Promise<void> => {
    if (!state.connectedTarget || !state.activeThreadId) return;
    const target = state.connectedTarget;
    const threadId = state.activeThreadId;
    const provider = state.provider;
    const cwd = state.cwd;
    const sequence = ++refreshSequence.current;
    setSlashSkillLoading(true);
    try {
      const [skillResult, commandResult] = await Promise.all([
        bridge.bridgeRpc.request.listSkills({ target, threadId, cwd, provider }),
        bridge.bridgeRpc.request.listCommands({ target, threadId, cwd, provider }),
      ]);
      const stillSelected = actions.isThreadSelected(target, provider, threadId);
      if (sequence !== refreshSequence.current || !stillSelected) return;
      setters.setSkills(skillResult.skills);
      setters.setSlashCommands(commandResult.commands);
      const warnings = [...skillResult.warnings, ...commandResult.warnings];
      setters.setSkillWarnings(warnings);
      refs.threadViews.update(target, provider, threadId, (view) => ({ ...view, skills: skillResult.skills, skillWarnings: warnings }));
      setSlashSkillIndex(0);
    } catch (error) {
      if (sequence === refreshSequence.current) setters.setSkillWarnings([errorMessage(error)]);
    } finally {
      if (sequence === refreshSequence.current) setSlashSkillLoading(false);
    }
  };

  useEffect(() => {
    if (slashMenuOpen) void refreshSlashSkills();
  }, [slashMenuOpen, state.connectedTarget, state.activeThreadId, state.provider]);

  const invalidateSlashSkillRefresh = (clearLoading = false): void => {
    refreshSequence.current += 1;
    if (clearLoading) setSlashSkillLoading(false);
  };

  const chooseSlashSkill = (skill: RemoteSkill): void => {
    setters.setSelectedSkill(skill);
    setters.setDraft("");
    setSlashSkillIndex(0);
  };

  const chooseSlashCommand = (command: RemoteCommand): void => {
    setters.setSelectedSkill(null);
    setters.setDraft(`/${command.name} `);
    setSlashSkillIndex(0);
  };

  const chooseSlashMenuItem = (item: SlashMenuItem): void => {
    if (item.kind === "skill") chooseSlashSkill(item.skill);
    else chooseSlashCommand(item.command);
  };

  return {
    slashMenuOpen,
    slashSkillIndex,
    setSlashSkillIndex,
    visibleSlashItems,
    slashSkillLoading,
    invalidateSlashSkillRefresh,
    chooseSlashSkill,
    chooseSlashCommand,
    chooseSlashMenuItem,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
