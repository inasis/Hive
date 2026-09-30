export interface PreferencesPort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PREFERENCE_KEYS = {
  desktopConnectionMode: "hive.desktop.connectionMode.v1",
  assistantProvider: "hive.assistantProvider.v1",
  sshTarget: "hive.sshTarget",
  theme: "hive.theme",
  daemonPairing: "hive.mobile.desktop.v1",
  persistentForkTabs: "hive.persistentForkTabs.v1",
} as const;
