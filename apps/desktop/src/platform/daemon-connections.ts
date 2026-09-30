import { ASSISTANT_PROVIDERS } from "../../../../src/domain/provider-catalog.js";
import type { AssistantThread } from "../../../../src/domain/assistant.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../../src/domain/workspace.js";
import { parseDaemonApiResponse } from "../../../../src/interfaces/contracts/daemon-response.js";
import type { BridgeEvent } from "../../../../src/interfaces/contracts/daemon-events.js";
import { normalizeDaemonCredentials } from "../../../../src/adapters/transport/daemon-credentials.js";
import { DaemonClientTransport } from "./daemon-client-transport";
import type { MobileBridgeCredentials } from "./mobile-daemon-socket";
import type { PreferencesPort } from "../shared/preferences";
import { PREFERENCE_KEYS } from "../shared/preferences";

export type DaemonConnection = {
  id: string;
  target: string;
  endpoint: string;
  hostname: string;
  state: "disconnected" | "connecting" | "connected";
  error: string;
  threads: AssistantThread[];
};
type SavedDaemon = MobileBridgeCredentials & { id: string; hostname?: string; displayName?: string };

/** Keep each authenticated transport and its catalog separate from the active conversation. */
export class DaemonConnections {
  private saved = new Map<string, SavedDaemon>();
  private transports = new Map<string, Pick<DaemonClientTransport, "request" | "connect" | "disconnect" | "addEventListener">>();
  private connections: DaemonConnection[] = [];
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(event: BridgeEvent) => void>();
  private started = false;

  constructor(
    private preferences: PreferencesPort,
    private createTransport: (id: string) => Pick<DaemonClientTransport, "request" | "connect" | "disconnect" | "addEventListener">,
  ) {
    let values: unknown;
    try {
      const stored = preferences.getItem(PREFERENCE_KEYS.daemonConnections);
      values = stored ? JSON.parse(stored) : undefined;
      if (!stored) {
        const legacy = preferences.getItem(PREFERENCE_KEYS.daemonPairing);
        if (legacy) values = [{ ...JSON.parse(legacy), id: crypto.randomUUID() }];
      }
    } catch { values = undefined; }
    if (Array.isArray(values)) for (const value of values) {
      if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^[\w-]{1,100}$/.test(value.id)) continue;
      try {
        const credentials = normalizeDaemonCredentials(value);
        const displayName = typeof value.displayName === "string" ? value.displayName.trim().slice(0, 100) : "";
        const saved = {
          ...credentials,
          id: value.id,
          ...(typeof value.hostname === "string" ? { hostname: value.hostname } : {}),
          ...(displayName ? { displayName } : {}),
        };
        this.saved.set(saved.id, saved);
      } catch { /* Ignore invalid stored credentials without sending them. */ }
    }
    this.connections = [...this.saved.values()].map((saved) => this.initial(saved));
    if (!preferences.getItem(PREFERENCE_KEYS.daemonConnections) && this.saved.size > 0) {
      this.persist();
      preferences.removeItem(PREFERENCE_KEYS.daemonPairing);
    }
  }

  snapshot = (): DaemonConnection[] => this.connections;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  addEventListener(listener: (event: BridgeEvent) => void): void { this.eventListeners.add(listener); }
  removeEventListener(listener: (event: BridgeEvent) => void): void { this.eventListeners.delete(listener); }

  start(): void {
    if (this.started && this.transports.size) return;
    this.started = true;
    for (const id of this.saved.keys()) void this.connect(id).catch(() => undefined);
  }

  async add(credentials: MobileBridgeCredentials): Promise<void> {
    const normalized = normalizeDaemonCredentials(credentials);
    if ([...this.saved.values()].some((saved) => saved.endpoint === normalized.endpoint)) {
      throw new Error("이미 등록된 데몬 주소입니다. 기존 연결에서 다시 연결하세요.");
    }
    const saved = { ...normalized, id: crypto.randomUUID() };
    this.saved.set(saved.id, saved);
    this.connections = [...this.connections, this.initial(saved)];
    this.emit();
    this.persist();
    await this.connect(saved.id);
  }

  async connect(id: string): Promise<void> {
    const saved = this.saved.get(id);
    if (!saved) throw new Error("등록된 데몬을 찾을 수 없습니다.");
    this.transports.get(id)?.disconnect();
    const transport = this.createTransport(id);
    this.transports.set(id, transport);
    transport.addEventListener((event) => {
      if (this.transports.get(id) === transport) this.receive({ ...event, target: `daemon:${id}` });
    });
    this.update(id, { state: "connecting", error: "" });
    try {
      await transport.connect(saved.endpoint, saved.token, saved.fingerprint);
      if (this.transports.get(id) !== transport) return;
      this.update(id, { state: "connected" });
      await this.loadCatalog(id);
    } catch (error) {
      if (this.transports.get(id) === transport) this.update(id, { state: "disconnected", error: message(error) });
      throw error;
    }
  }

  disconnect(id: string): void {
    this.transports.get(id)?.disconnect();
    this.transports.delete(id);
    this.update(id, { state: "disconnected" });
    this.publish({ target: `daemon:${id}`, threadId: "", method: "hive/transport/failed", params: { message: "데몬 연결을 종료했습니다." } });
  }

  remove(id: string): void {
    this.disconnect(id);
    this.saved.delete(id);
    this.connections = this.connections.filter((connection) => connection.id !== id);
    this.persist();
    this.emit();
  }

  rename(id: string, name: string): void {
    const saved = this.saved.get(id);
    if (!saved) throw new Error("등록된 데몬을 찾을 수 없습니다.");
    const displayName = name.trim();
    if (!displayName) throw new Error("데몬 이름을 입력하세요.");
    if (displayName.length > 100) throw new Error("데몬 이름은 100자 이내로 입력하세요.");
    saved.displayName = displayName;
    this.update(id, { hostname: displayName });
    this.persist();
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const object = typeof params === "object" && params !== null ? params as Record<string, unknown> : {};
    const target = typeof object.target === "string" && object.target.startsWith("daemon:")
      ? object.target : this.connections.find((connection) => connection.state === "connected")?.target;
    const id = target?.slice(7);
    const transport = id ? this.transports.get(id) : undefined;
    if (!transport || !id) throw new Error("연결할 데몬을 추가하거나 선택하세요.");
    const wireParams = "target" in object ? { ...object, target: LOCAL_WORKSPACE_TARGET } : object;
    const result = await transport.request(method, wireParams);
    if (this.transports.get(id) !== transport) throw new Error("데몬 연결이 변경되었습니다. 다시 시도하세요.");
    if (method === "connect") {
      const catalog = parseDaemonApiResponse("connect", result);
      const provider = object.provider;
      const current = this.connections.find((connection) => connection.id === id);
      const saved = this.saved.get(id);
      this.update(id, {
        hostname: saved?.displayName || catalog.hostname?.trim() || current?.hostname || "",
        threads: [...(current?.threads.filter((thread) => thread.provider !== provider) ?? []), ...catalog.threads],
      });
      if (catalog.hostname && saved) { saved.hostname = catalog.hostname; this.persist(); }
    }
    if (typeof result === "object" && result !== null && "target" in result) return { ...result, target };
    return result;
  }

  updateThreads(target: string, threads: AssistantThread[]): void {
    this.update(target.slice(7), { threads });
  }

  receive(event: BridgeEvent): void {
    if (!event.target.startsWith("daemon:")) return;
    const id = event.target.slice(7);
    if (!this.saved.has(id)) return;
    const connection = this.connections.find((item) => item.id === id);
    if (connection && event.provider) {
      const provider = event.provider;
      const matches = (thread: AssistantThread) => thread.provider === provider && thread.id === event.threadId;
      if (event.method === "thread/deleted") this.update(id, { threads: connection.threads.filter((thread) => !matches(thread)) });
      if (event.method === "thread/name/updated" && typeof event.params.name === "string") {
        const title = event.params.name;
        this.update(id, { threads: connection.threads.map((thread) => matches(thread) ? { ...thread, title } : thread) });
      }
      if (event.method === "thread/created" && typeof event.params.name === "string" && typeof event.params.cwd === "string") {
        const thread: AssistantThread = {
          id: event.threadId,
          provider,
          title: event.params.name,
          cwd: event.params.cwd,
          preview: typeof event.params.preview === "string" ? event.params.preview : "",
          updatedAt: typeof event.params.updatedAt === "string" || typeof event.params.updatedAt === "number" ? event.params.updatedAt : null,
        };
        this.update(id, { threads: [...connection.threads.filter((item) => !matches(item)), thread] });
      }
    }
    if (event.method === "hive/transport/disconnected") this.update(id, { state: "connecting" });
    if (event.method === "hive/transport/failed") this.update(id, { state: "disconnected", error: typeof event.params.message === "string" ? event.params.message : "" });
    if (event.method === "hive/transport/reconnected") {
      this.update(id, { state: "connected", error: "" });
      void this.loadCatalog(id).catch(() => undefined);
    }
    this.publish(event);
  }

  private async loadCatalog(id: string): Promise<void> {
    await Promise.allSettled(ASSISTANT_PROVIDERS.map(({ id: provider }) => this.request("connect", { target: `daemon:${id}`, provider })));
  }

  private initial(saved: SavedDaemon): DaemonConnection {
    return {
      id: saved.id,
      target: `daemon:${saved.id}`,
      endpoint: saved.endpoint,
      hostname: saved.displayName || saved.hostname || new URL(saved.endpoint).hostname,
      state: "disconnected",
      error: "",
      threads: [],
    };
  }

  private update(id: string, changes: Partial<DaemonConnection>): void {
    this.connections = this.connections.map((connection) => connection.id === id ? { ...connection, ...changes } : connection);
    this.emit();
  }
  private persist(): void { this.preferences.setItem(PREFERENCE_KEYS.daemonConnections, JSON.stringify([...this.saved.values()])); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private publish(event: BridgeEvent): void { for (const listener of this.eventListeners) listener(event); }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
