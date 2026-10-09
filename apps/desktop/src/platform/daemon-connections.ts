import { ASSISTANT_PROVIDERS } from "../../../../src/domain/provider-catalog.js";
import type { AssistantThreadDto } from "../../../../src/application/dto/assistant.js";
import { LOCAL_WORKSPACE_TARGET } from "../../../../src/domain/workspace.js";
import { parseDaemonApiResponse } from "../../../../src/application/dto/daemon/daemon-response.js";
import type { BridgeEvent } from "../../../../src/application/dto/daemon/daemon-events.js";
import { normalizeDaemonCredentials } from "../../../../src/infrastructure/transport/daemon-credentials.js";
import { DaemonClientTransport } from "./daemon-client-transport";
import type { DaemonConnection, DaemonConnectionCredentials } from "../../../../src/presentation/shared/daemon-connections";
import type { PreferencesPort } from "../../../../src/presentation/shared/preferences";
import { DaemonConnectionStore, type SavedDaemonConnection } from "./daemon-connection-store";
import { applyThreadCatalogEvent, replaceProviderThreads } from "./daemon-thread-catalog";

/** Keep each authenticated transport and its catalog separate from the active conversation. */
export class DaemonConnections {
  private saved = new Map<string, SavedDaemonConnection>();
  private transports = new Map<string, Pick<DaemonClientTransport, "request" | "connect" | "disconnect" | "addEventListener">>();
  private connections: DaemonConnection[] = [];
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(event: BridgeEvent) => void>();
  private started = false;
  private readonly store: DaemonConnectionStore;

  constructor(
    preferences: PreferencesPort,
    private createTransport: (id: string) => Pick<DaemonClientTransport, "request" | "connect" | "disconnect" | "addEventListener">,
  ) {
    this.store = new DaemonConnectionStore(preferences);
    for (const saved of this.store.load()) this.saved.set(saved.id, saved);
    this.connections = [...this.saved.values()].map((saved) => this.initial(saved));
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

  async add(credentials: DaemonConnectionCredentials): Promise<void> {
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
        threads: replaceProviderThreads(current?.threads ?? [], provider, catalog.threads),
      });
      if (catalog.hostname && saved) { saved.hostname = catalog.hostname; this.persist(); }
    }
    if (typeof result === "object" && result !== null && "target" in result) return { ...result, target };
    return result;
  }

  updateThreads(target: string, threads: AssistantThreadDto[]): void {
    this.update(target.slice(7), { threads });
  }

  receive(event: BridgeEvent): void {
    if (!event.target.startsWith("daemon:")) return;
    const id = event.target.slice(7);
    if (!this.saved.has(id)) return;
    const connection = this.connections.find((item) => item.id === id);
    if (connection) {
      const threads = applyThreadCatalogEvent(connection.threads, event);
      if (threads) this.update(id, { threads });
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

  private initial(saved: SavedDaemonConnection): DaemonConnection {
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
  private persist(): void { this.store.save([...this.saved.values()]); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private publish(event: BridgeEvent): void { for (const listener of this.eventListeners) listener(event); }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
