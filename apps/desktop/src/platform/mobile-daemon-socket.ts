import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type MobileBridgeCredentials = { endpoint: string; token: string; fingerprint: string };

export type MobileDaemonSocketEvents = {
  open(): void;
  message(data: string): void;
  error(message: string): void;
  close(code: number, reason: string): void;
};

type HiveTransportPlugin = {
  connect(options: { url: string; fingerprint: string }): Promise<void>;
  send(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  setKeepAlive(options: { enabled: boolean }): Promise<void>;
  setStatusBarAppearance(options: { light: boolean }): Promise<void>;
  addListener(event: "message", listener: (event: { data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "error", listener: (event: { message: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "close", listener: (event: { code: number; reason: string }) => void): Promise<PluginListenerHandle>;
};

const hiveTransport = registerPlugin<HiveTransportPlugin>("HiveTransport");

/** Own the physical browser WebSocket or Android Capacitor transport connection. */
export class MobileDaemonSocket {
  private socket: WebSocket | undefined;
  private sendOperation: ((data: string) => void | Promise<void>) | undefined;
  private closeOperation: (() => void) | undefined;
  private nativeListenerHandles: PluginListenerHandle[] = [];

  constructor(private readonly android: boolean) {}

  setStatusBarAppearance(light: boolean): void {
    if (this.android) void hiveTransport.setStatusBarAppearance({ light }).catch(() => {});
  }

  setKeepAlive(enabled: boolean): Promise<void> {
    return this.android ? hiveTransport.setKeepAlive({ enabled }) : Promise.resolve();
  }

  async connect(credentials: MobileBridgeCredentials, events: MobileDaemonSocketEvents): Promise<void> {
    if (this.android) return this.connectAndroid(credentials, events);
    return this.connectBrowser(credentials.endpoint, events);
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
    if (this.android) void hiveTransport.disconnect();
    else this.close();
  }

  reset(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.sendOperation = undefined;
    this.closeOperation = undefined;
    for (const handle of this.nativeListenerHandles) void handle.remove();
    this.nativeListenerHandles = [];
  }

  private async connectAndroid(credentials: MobileBridgeCredentials, events: MobileDaemonSocketEvents): Promise<void> {
    await hiveTransport.disconnect();
    this.nativeListenerHandles = await Promise.all([
      hiveTransport.addListener("message", ({ data }) => events.message(data)),
      hiveTransport.addListener("error", ({ message }) => events.error(message)),
      hiveTransport.addListener("close", ({ code, reason }) => events.close(code, reason)),
    ]);
    this.closeOperation = () => { void hiveTransport.disconnect(); };
    await hiveTransport.connect({ url: credentials.endpoint, fingerprint: credentials.fingerprint });
    this.sendOperation = (data) => hiveTransport.send({ data });
    events.open();
  }

  private connectBrowser(endpoint: string, events: MobileDaemonSocketEvents): Promise<void> {
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
        opened = true;
        events.open();
        resolve();
      };
      socket.onmessage = (message) => { if (typeof message.data === "string") events.message(message.data); };
      socket.onerror = () => {
        const message = "Hive 데몬 연결 오류입니다. 주소와 네트워크를 확인하세요.";
        events.error(message);
        if (!opened) reject(new Error(message));
      };
      socket.onclose = (event) => {
        events.close(event.code, event.reason);
        if (!opened) {
          const message = event.code === 1008 ? "페어링 토큰을 확인하세요." : event.reason || "Hive 데몬 연결이 종료되었습니다.";
          reject(new Error(message));
        }
      };
    });
  }
}
