import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type DaemonWssCredentials = { endpoint: string; token: string; fingerprint: string };

export type DaemonWssSocketEvents = {
  open(): void;
  message(data: string): void;
  error(message: string): void;
  close(code: number, reason: string): void;
  resume(): void;
};

type HiveTransportPlugin = {
  connect(options: { url: string; fingerprint: string; connectionId: string }): Promise<void>;
  send(options: { data: string; connectionId: string }): Promise<void>;
  disconnect(options?: { connectionId?: string }): Promise<void>;
  setKeepAlive(options: { enabled: boolean; connectionId: string }): Promise<void>;
  addListener(event: "message", listener: (event: { connectionId: string; data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "error", listener: (event: { connectionId: string; message: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "close", listener: (event: { connectionId: string; code: number; reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "resume", listener: () => void): Promise<PluginListenerHandle>;
};

const hiveTransport = registerPlugin<HiveTransportPlugin>("HiveTransport");

/** Own the physical browser WebSocket or Android Capacitor transport connection. */
export class DaemonWssSocket {
  private socket: WebSocket | undefined;
  private sendOperation: ((data: string) => void | Promise<void>) | undefined;
  private closeOperation: (() => void) | undefined;
  private nativeListenerHandles: PluginListenerHandle[] = [];
  private generation = 0;
  private readonly keepAliveId = crypto.randomUUID();
  private nativeConnectionId: string | undefined;

  constructor(private readonly android: boolean, private readonly onAndroidConnected: () => void = () => {}) {}

  setKeepAlive(enabled: boolean): Promise<void> {
    return this.android ? hiveTransport.setKeepAlive({ enabled, connectionId: this.keepAliveId }) : Promise.resolve();
  }

  async connect(credentials: DaemonWssCredentials, events: DaemonWssSocketEvents): Promise<void> {
    const generation = ++this.generation;
    if (this.android) return this.connectAndroid(credentials, events, generation);
    return this.connectBrowser(credentials.endpoint, events, generation);
  }

  send(data: string): void | Promise<void> {
    if (!this.sendOperation) throw new Error("Hive 데몬 연결이 끊어졌습니다.");
    return this.sendOperation(data);
  }

  canSend(): boolean {
    return Boolean(this.sendOperation) && (!this.socket || this.socket.readyState === WebSocket.OPEN);
  }

  close(): void {
    this.closeOperation?.();
  }

  disconnect(): void {
    this.reset();
  }

  reset(): void {
    this.generation += 1;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.sendOperation = undefined;
    const closeOperation = this.closeOperation;
    this.closeOperation = undefined;
    this.nativeConnectionId = undefined;
    closeOperation?.();
    for (const handle of this.nativeListenerHandles) void handle.remove();
    this.nativeListenerHandles = [];
  }

  private async connectAndroid(credentials: DaemonWssCredentials, events: DaemonWssSocketEvents, generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return;
    const connectionId = `hive-${crypto.randomUUID()}`;
    this.nativeConnectionId = connectionId;
    this.nativeListenerHandles = await Promise.all([
      hiveTransport.addListener("message", ({ connectionId: eventConnectionId, data }) => {
        if (this.isCurrent(generation) && eventConnectionId === connectionId) events.message(data);
      }),
      hiveTransport.addListener("error", ({ connectionId: eventConnectionId, message }) => {
        if (this.isCurrent(generation) && eventConnectionId === connectionId) events.error(message);
      }),
      hiveTransport.addListener("close", ({ connectionId: eventConnectionId, code, reason }) => {
        if (this.isCurrent(generation) && eventConnectionId === connectionId) events.close(code, reason);
      }),
      hiveTransport.addListener("resume", () => {
        if (this.isCurrent(generation)) events.resume();
      }),
    ]);
    if (!this.isCurrent(generation)) return;
    this.closeOperation = () => { void hiveTransport.disconnect({ connectionId }); };
    await hiveTransport.connect({ url: credentials.endpoint, fingerprint: credentials.fingerprint, connectionId });
    if (!this.isCurrent(generation) || this.nativeConnectionId !== connectionId) return;
    this.sendOperation = (data) => hiveTransport.send({ data, connectionId });
    events.open();
    this.onAndroidConnected();
  }

  private connectBrowser(endpoint: string, events: DaemonWssSocketEvents, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let opened = false;
      const socket = new WebSocket(endpoint);
      this.socket = socket;
      this.sendOperation = (data) => {
        if (socket.readyState !== WebSocket.OPEN) throw new Error("Hive daemon WebSocket is not open");
        socket.send(data);
      };
      this.closeOperation = () => { if (socket.readyState < WebSocket.CLOSING) socket.close(); };
      socket.onopen = () => {
        if (!this.isCurrent(generation) || this.socket !== socket) return;
        opened = true;
        events.open();
        resolve();
      };
      socket.onmessage = (message) => {
        if (this.isCurrent(generation) && this.socket === socket && typeof message.data === "string") events.message(message.data);
      };
      socket.onerror = () => {
        if (!this.isCurrent(generation) || this.socket !== socket) return;
        const message = "Hive 데몬 연결 오류입니다. 주소와 네트워크를 확인하세요.";
        events.error(message);
        if (!opened) reject(new Error(message));
      };
      socket.onclose = (event) => {
        if (!this.isCurrent(generation) || this.socket !== socket) return;
        events.close(event.code, event.reason);
        if (!opened) {
          const message = event.code === 1008 ? "페어링 토큰을 확인하세요." : event.reason || "Hive 데몬 연결이 종료되었습니다.";
          reject(new Error(message));
        }
      };
    });
  }

  private isCurrent(generation: number): boolean {
    return this.generation === generation;
  }
}
