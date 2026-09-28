import type { ComponentProps } from "react";
import { ConversationWorkspace } from "../conversation/ConversationWorkspace";
import { SkillsPage } from "../skills/SkillsPage";
import { ConnectionSettingsPage, ThemeSettingsPage } from "../settings/SettingsPage";
import type { AppPage, SettingsSection } from "./workspace-types";

type WorkspacePageContentProps = {
  page: AppPage;
  settingsSection: SettingsSection;
  conversation: ComponentProps<typeof ConversationWorkspace>;
  skills: ComponentProps<typeof SkillsPage>;
  theme: ComponentProps<typeof ThemeSettingsPage>;
  connection: ComponentProps<typeof ConnectionSettingsPage>;
};

export function WorkspacePageContent({ page, settingsSection, conversation, skills, theme, connection }: WorkspacePageContentProps) {
  return <>
    {page === "sessions" && <ConversationWorkspace {...conversation} />}
    {page === "skills" && <SkillsPage {...skills} />}
    {page === "settings" && settingsSection === "theme" && <ThemeSettingsPage {...theme} />}
    {page === "settings" && settingsSection === "connection" && <ConnectionSettingsPage {...connection} />}
  </>;
}
