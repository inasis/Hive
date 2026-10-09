import { normalizeDaemonCredentials } from "../../../../src/infrastructure/transport/daemon-credentials.js";
import type { PreferencesPort } from "../../../../src/presentation/shared/preferences";
import { PREFERENCE_KEYS } from "../../../../src/presentation/shared/preferences";
import type { DaemonConnectionCredentials } from "../../../../src/presentation/shared/daemon-connections";

export type SavedDaemonConnection = DaemonConnectionCredentials & {
  id: string;
  hostname?: string;
  displayName?: string;
};

/** Loads and persists saved daemon credentials, including the legacy single-daemon migration. */
export class DaemonConnectionStore {
  constructor(private readonly preferences: PreferencesPort) {}

  load(): SavedDaemonConnection[] {
    let values: unknown;
    try {
      const stored = this.preferences.getItem(PREFERENCE_KEYS.daemonConnections);
      values = stored ? JSON.parse(stored) : undefined;
      if (!stored) {
        const legacy = this.preferences.getItem(PREFERENCE_KEYS.daemonPairing);
        if (legacy) values = [{ ...JSON.parse(legacy), id: crypto.randomUUID() }];
      }
    } catch {
      values = undefined;
    }

    const saved = new Map<string, SavedDaemonConnection>();
    if (Array.isArray(values)) for (const value of values) {
      if (!isSavedDaemonInput(value)) continue;
      try {
        const credentials = normalizeDaemonCredentials(value);
        const displayName = typeof value.displayName === "string" ? value.displayName.trim().slice(0, 100) : "";
        const daemon: SavedDaemonConnection = {
          ...credentials,
          id: value.id,
          ...(typeof value.hostname === "string" ? { hostname: value.hostname } : {}),
          ...(displayName ? { displayName } : {}),
        };
        saved.set(daemon.id, daemon);
      } catch { /* Ignore invalid stored credentials without sending them. */ }
    }

    if (!this.preferences.getItem(PREFERENCE_KEYS.daemonConnections) && saved.size > 0) {
      this.save([...saved.values()]);
      this.preferences.removeItem(PREFERENCE_KEYS.daemonPairing);
    }
    return [...saved.values()];
  }

  save(saved: readonly SavedDaemonConnection[]): void {
    this.preferences.setItem(PREFERENCE_KEYS.daemonConnections, JSON.stringify(saved));
  }
}

function isSavedDaemonInput(value: unknown): value is SavedDaemonConnection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && /^[\w-]{1,100}$/.test(record.id)
    && typeof record.endpoint === "string"
    && typeof record.token === "string"
    && typeof record.fingerprint === "string";
}
