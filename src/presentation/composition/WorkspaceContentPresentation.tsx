import { getConnectionPresentation } from "../features/connection/connection-presentation";
import { WorkspacePageContent } from "../WorkspacePageContent";
import { formatWorkspaceTargetLabel } from "../shared/workspace-target-label";
import type { WorkspacePagePresentationProps } from "./workspace-page-presentation-types";
import { buildWorkspaceConversationPresentation } from "./workspace-conversation-presentation";

/** Build the active page's feature-specific presentation contracts. */
export function WorkspaceContentPresentation({
  externalActions,
  platform,
  daemons,
  personaProfiles,
  theme,
  connectionUi,
  conversationUi,
  forkUi,
  navigation,
  tabs,
  view,
  conversationFeatures,
  connectionFeatures,
  sessionFeatures,
  skillsBrowser,
  turnControls,
  composerSubmission,
  notice,
  setNotice,
}: WorkspacePagePresentationProps) {
  const { state: connection, setters: connectionSetters } = connectionUi;
  const { state: conversation, setters: conversationSetters } = conversationUi;
  const { activePage, setActivePage, settingsSection, setSettingsSection, openSettings } = navigation;
  const { assistantProviderName, modelWarning } = view;
  const { connect, chooseProvider, disconnect } = connectionFeatures;
  const { filter, setFilter, provider: skillProvider, setProvider: setSkillProvider, visibleSkills } = skillsBrowser;

  return <WorkspacePageContent
    page={activePage}
    personaProfiles={personaProfiles}
    roleSpaceActions={{
      onOpenPersona: (profileId) => { personaProfiles.selectProfile(profileId); navigation.navigate("persona"); },
      onAddPersona: (spaceId) => { personaProfiles.addProfile(spaceId); navigation.navigate("persona"); },
    }}
    onOpenRoleSpace={() => navigation.navigate("role-space")}
    settingsSection={settingsSection}
    onChangeSettingsSection={setSettingsSection}
    conversation={buildWorkspaceConversationPresentation({
      daemons,
      connectionUi,
      conversationUi,
      forkUi,
      navigation,
      tabs,
      view,
      conversationFeatures,
      sessionFeatures,
      turnControls,
      composerSubmission,
      notice,
      setNotice,
    })}
    skills={{
      skills: conversation.skills,
      visibleSkills,
      warnings: conversation.skillWarnings,
      connectionState: connection.connectionState,
      activeThreadId: conversation.activeThreadId,
      selectedProvider: skillProvider,
      onProviderChange: setSkillProvider,
      filter,
      onFilterChange: setFilter,
      onOpenConnectionSettings: () => openSettings("connection"),
      onOpenSessions: () => setActivePage("sessions"),
      onUseSkill: (skill) => { conversationSetters.setSelectedSkill(skill); conversationSetters.setDraft(""); setActivePage("sessions"); },
    }}
    theme={{ theme: theme.theme, onToggleTheme: theme.toggleTheme }}
    providerSettings={{
      provider: connection.assistantProvider,
      providerOptions: connection.availableProviders,
      busy: conversation.busy,
      onProviderChange: (provider) => chooseProvider(provider, true),
    }}
    connection={{
      presentation: getConnectionPresentation(connection.assistantProvider, platform.isDaemonClient, assistantProviderName),
      providerName: assistantProviderName,
      daemonClient: platform.isDaemonClient,
      target: connection.target,
      workspaceHost: daemons.find((daemon) => daemon.target === connection.connectedTarget)?.hostname ?? (platform.isDaemonClient ? "선택한 서버 없음" : formatWorkspaceTargetLabel(connection.connectedTarget || connection.target) || "이 컴퓨터"),
      connectionState: connection.connectionState,
      notice,
      modelWarning,
      onTargetChange: connectionSetters.setTarget,
      onConnect: () => {
        if (platform.isDaemonClient) void connect(connection.connectedTarget || daemons.find((daemon) => daemon.state === "connected")?.target);
        else void connect();
      },
      onDisconnect: () => void disconnect(),
      onOpenProviderSettings: () => setSettingsSection("provider"),
      onOpenDaemonSettings: () => setSettingsSection("daemons"),
      onUseDirectConnection: externalActions.onUseDirectConnection,
      onUseDaemonConnection: externalActions.onUseDaemonConnection,
    }}
  />;
}
