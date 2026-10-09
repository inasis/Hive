import type { PreferencesPort } from "../../../../src/presentation/shared/preferences";

/** Browser-backed preference storage shared by desktop and Capacitor renderers. */
export const browserPreferences: PreferencesPort = {
  getItem(key: string): string | null {
    return localStorage.getItem(key);
  },

  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  },

  removeItem(key: string): void {
    localStorage.removeItem(key);
  },
};
