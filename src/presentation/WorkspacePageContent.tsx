import { lazy, Suspense, type ComponentProps } from "react";
import type { ConversationWorkspace as ConversationWorkspaceComponent } from "./features/conversation/ConversationWorkspace";
import type { SkillsPage as SkillsPageComponent } from "./features/skills/SkillsPage";
import type { ConnectionSettingsPage as ConnectionSettingsPageComponent } from "./features/settings/ConnectionSettingsPage";
import type { ProviderSettingsPage as ProviderSettingsPageComponent, ThemeSettingsPage as ThemeSettingsPageComponent } from "./features/settings/SettingsPage";
import type { usePersonaProfiles } from "./features/settings/usePersonaProfiles";
import { Icon } from "./shared/Icon";
import type { AppPage, SettingsSection } from "./shared/workspace-state";

const ConversationWorkspace = lazy(() => import("./features/conversation/ConversationWorkspace").then(({ ConversationWorkspace: component }) => ({ default: component })));
const SkillsPage = lazy(() => import("./features/skills/SkillsPage").then(({ SkillsPage: component }) => ({ default: component })));
const ConnectionSettingsPage = lazy(() => import("./features/settings/ConnectionSettingsPage").then(({ ConnectionSettingsPage: component }) => ({ default: component })));
const PersonaSettingsPage = lazy(() => import("./features/settings/PersonaSettingsPage").then(({ PersonaSettingsPage: component }) => ({ default: component })));
const RoleSpaceSettingsPage = lazy(() => import("./features/settings/RoleSpaceSettingsPage").then(({ RoleSpaceSettingsPage: component }) => ({ default: component })));
const McpSettingsPage = lazy(() => import("./features/settings/SettingsPage").then(({ McpSettingsPage: component }) => ({ default: component })));
const ProviderSettingsPage = lazy(() => import("./features/settings/SettingsPage").then(({ ProviderSettingsPage: component }) => ({ default: component })));
const ThemeSettingsPage = lazy(() => import("./features/settings/SettingsPage").then(({ ThemeSettingsPage: component }) => ({ default: component })));
const DaemonManagementSettingsPage = lazy(() => import("./features/settings/DaemonManagementSettingsPage").then(({ DaemonManagementSettingsPage: component }) => ({ default: component })));

type WorkspacePageContentProps = {
  page: AppPage;
  personaProfiles: ReturnType<typeof usePersonaProfiles>;
  settingsSection: SettingsSection;
  onChangeSettingsSection: (section: SettingsSection) => void;
  conversation: ComponentProps<typeof ConversationWorkspaceComponent>;
  skills: ComponentProps<typeof SkillsPageComponent>;
  theme: ComponentProps<typeof ThemeSettingsPageComponent>;
  providerSettings: ComponentProps<typeof ProviderSettingsPageComponent>;
  connection: ComponentProps<typeof ConnectionSettingsPageComponent>;
  roleSpaceActions: {
    onOpenPersona: (profileId: string) => void;
    onAddPersona: (spaceId: string) => void;
  };
  onOpenRoleSpace: () => void;
};

export function WorkspacePageContent({ page, personaProfiles, settingsSection, onChangeSettingsSection, conversation, skills, theme, providerSettings, connection, roleSpaceActions, onOpenRoleSpace }: WorkspacePageContentProps) {
  return <>
    {page === "sessions" && <Suspense fallback={<PageLoadingState />}><ConversationWorkspace {...conversation} /></Suspense>}
    {page === "role-space" && <Suspense fallback={<PageLoadingState />}><RoleSpaceSettingsPage {...personaProfiles} {...roleSpaceActions} /></Suspense>}
    {page === "persona" && <Suspense fallback={<PageLoadingState />}><PersonaSettingsPage {...personaProfiles} onOpenRoleSpace={onOpenRoleSpace} /></Suspense>}
    {page === "settings" && <nav className="settings-section-nav" aria-label="설정 페이지">
      <button type="button" className={settingsSection === "connection" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "connection" ? "page" : undefined} onClick={() => onChangeSettingsSection("connection")}><Icon name="branch" /><span>연결</span></button>
      <button type="button" className={settingsSection === "provider" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "provider" ? "page" : undefined} onClick={() => onChangeSettingsSection("provider")}><Icon name="plug" /><span>Provider</span></button>
      {connection.daemonClient && <button type="button" className={settingsSection === "daemons" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "daemons" ? "page" : undefined} onClick={() => onChangeSettingsSection("daemons")}><Icon name="settings" /><span>서버 관리</span></button>}
      <button type="button" className={settingsSection === "skills" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "skills" ? "page" : undefined} onClick={() => onChangeSettingsSection("skills")}><Icon name="sparkles" /><span>스킬</span></button>
      <button type="button" className={settingsSection === "mcp" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "mcp" ? "page" : undefined} onClick={() => onChangeSettingsSection("mcp")}><Icon name="plug" /><span>MCP</span></button>
      <button type="button" className={settingsSection === "theme" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "theme" ? "page" : undefined} onClick={() => onChangeSettingsSection("theme")}><Icon name="sun" /><span>테마</span></button>
    </nav>}
    {page === "settings" && settingsSection === "skills" && <Suspense fallback={<PageLoadingState />}><SkillsPage {...skills} /></Suspense>}
    {page === "settings" && settingsSection === "provider" && <Suspense fallback={<PageLoadingState />}><ProviderSettingsPage {...providerSettings} /></Suspense>}
    {page === "settings" && settingsSection === "daemons" && connection.daemonClient && <Suspense fallback={<PageLoadingState />}><DaemonManagementSettingsPage /></Suspense>}
    {page === "settings" && settingsSection === "mcp" && <Suspense fallback={<PageLoadingState />}><McpSettingsPage /></Suspense>}
    {page === "settings" && settingsSection === "theme" && <Suspense fallback={<PageLoadingState />}><ThemeSettingsPage {...theme} /></Suspense>}
    {page === "settings" && settingsSection === "connection" && <Suspense fallback={<PageLoadingState />}><ConnectionSettingsPage {...connection} /></Suspense>}
  </>;
}

function PageLoadingState() {
  return <div className="inline-state" role="status">화면을 불러오는 중…</div>;
}
