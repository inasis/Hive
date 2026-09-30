import type { ComponentProps } from "react";
import { ConversationWorkspace } from "./features/conversation/ConversationWorkspace";
import { SkillsPage } from "./features/skills/SkillsPage";
import { ConnectionSettingsPage, McpSettingsPage, ThemeSettingsPage } from "./features/settings/SettingsPage";
import { Icon } from "./shared/Icon";
import type { AppPage, SettingsSection } from "./shared/workspace-state";

type WorkspacePageContentProps = {
  page: AppPage;
  settingsSection: SettingsSection;
  onChangeSettingsSection: (section: SettingsSection) => void;
  conversation: ComponentProps<typeof ConversationWorkspace>;
  skills: ComponentProps<typeof SkillsPage>;
  theme: ComponentProps<typeof ThemeSettingsPage>;
  connection: ComponentProps<typeof ConnectionSettingsPage>;
};

export function WorkspacePageContent({ page, settingsSection, onChangeSettingsSection, conversation, skills, theme, connection }: WorkspacePageContentProps) {
  return <>
    {page === "sessions" && <ConversationWorkspace {...conversation} />}
    {page === "settings" && <nav className="settings-section-nav" aria-label="설정 페이지">
      <button type="button" className={settingsSection === "connection" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "connection" ? "page" : undefined} onClick={() => onChangeSettingsSection("connection")}><Icon name="branch" /><span>연결</span></button>
      <button type="button" className={settingsSection === "skills" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "skills" ? "page" : undefined} onClick={() => onChangeSettingsSection("skills")}><Icon name="sparkles" /><span>스킬</span></button>
      <button type="button" className={settingsSection === "mcp" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "mcp" ? "page" : undefined} onClick={() => onChangeSettingsSection("mcp")}><Icon name="plug" /><span>MCP</span></button>
      <button type="button" className={settingsSection === "theme" ? "settings-section-item active" : "settings-section-item"} aria-current={settingsSection === "theme" ? "page" : undefined} onClick={() => onChangeSettingsSection("theme")}><Icon name="sun" /><span>테마</span></button>
    </nav>}
    {page === "settings" && settingsSection === "skills" && <SkillsPage {...skills} />}
    {page === "settings" && settingsSection === "mcp" && <McpSettingsPage />}
    {page === "settings" && settingsSection === "theme" && <ThemeSettingsPage {...theme} />}
    {page === "settings" && settingsSection === "connection" && <ConnectionSettingsPage {...connection} />}
  </>;
}
