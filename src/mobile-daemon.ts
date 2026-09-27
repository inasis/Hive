import { createHash, randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { generate as generateSelfSigned } from "selfsigned";
import { dispatchDaemonRequest, stopOpenCodeProvider, subscribeDaemonEvents, warmOpenCodeProvider } from "./daemon-api-handlers.js";
import { isDaemonApiMethod } from "./daemon-api-contract.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 64;
type MobileEvent = { target: string; threadId: string; method: string; params: unknown; requestId?: number | string };
type MobileRequestDispatcher = (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>;
type MobilePeer = { socket: Duplex; buffer: Buffer; authenticated: boolean; activeRequests: number; closed: boolean };

const mobilePeers = new Set<MobilePeer>();

/** Run the standalone WSS endpoint used by the Capacitor client. */
export async function runHiveMobileDaemon(): Promise<void> {
  const bind = process.env.HIVE_MOBILE_BIND?.trim() || "0.0.0.0:4753";
  const certificatePath = process.env.HIVE_MOBILE_TLS_CERT?.trim();
  const privateKeyPath = process.env.HIVE_MOBILE_TLS_KEY?.trim();
  if (Boolean(certificatePath) !== Boolean(privateKeyPath)) {
    throw new Error("Set both HIVE_MOBILE_TLS_CERT and HIVE_MOBILE_TLS_KEY, or let Hive create its local certificate");
  }
  const { host, port } = parseBindAddress(bind);
  const endpoints = getPublicEndpoints(host, port, process.env.HIVE_MOBILE_PUBLIC_URL?.trim());
  const token = await getMobileToken();
  const { cert, key, fingerprint } = await getTlsMaterial(endpoints, certificatePath, privateKeyPath);
  const server = createHttpsServer({ cert, key });
  const peers = new Set<MobilePeer>();

  server.on("upgrade", (request, socket, head) => {
    if (!isAllowedOrigin(request.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const websocketKey = request.headers["sec-websocket-key"];
    if (request.url !== "/rpc" || request.headers.upgrade?.toLowerCase() !== "websocket" ||
        typeof websocketKey !== "string" || peers.size >= 8) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(websocketKey + WEBSOCKET_GUID).digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);

    const peer: MobilePeer = { socket, buffer: Buffer.alloc(0), authenticated: false, activeRequests: 0, closed: false };
    peers.add(peer);
    mobilePeers.add(peer);
    const authTimer = setTimeout(() => closePeer(peer, 1008, "Authentication required"), 10_000);
    socket.on("data", (chunk) => receiveFrames(peer, chunk, async (text) => {
      if (!peer.authenticated) {
        let message: Record<string, unknown>;
        try { message = parseObject(text); }
        catch { closePeer(peer, 1008, "Invalid authentication message"); return; }
        if (message.type !== "authenticate" || !secureCompare(message.token, token)) {
          closePeer(peer, 1008, "Authentication failed");
          return;
        }
        clearTimeout(authTimer);
        peer.authenticated = true;
        sendJson(peer, { type: "authenticated" });
        return;
      }

      let message: Record<string, unknown>;
      try { message = parseObject(text); }
      catch { sendJson(peer, { type: "error", error: "Invalid request message" }); return; }
      if (message.type !== "request" || (typeof message.id !== "number" && typeof message.id !== "string") ||
          typeof message.method !== "string" || !isDaemonApiMethod(message.method)) {
        sendJson(peer, { type: "error", error: "Unsupported mobile daemon request" });
        return;
      }
      if (peer.activeRequests >= MAX_ACTIVE_REQUESTS) {
        sendJson(peer, { type: "response", id: message.id, error: "Too many active requests" });
        return;
      }
      peer.activeRequests += 1;
      try {
        const result = await dispatchDaemonRequest(message.method, parseParams(message.params));
        sendJson(peer, { type: "response", id: message.id, result });
      } catch (error) {
        sendJson(peer, { type: "response", id: message.id, error: errorMessage(error) });
      } finally {
        peer.activeRequests -= 1;
      }
    }));
    socket.once("close", () => {
      clearTimeout(authTimer);
      peer.closed = true;
      peers.delete(peer);
      mobilePeers.delete(peer);
    });
    socket.once("error", () => closePeer(peer, 1011, "Socket error"));
    if (head.length) socket.emit("data", head);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      process.stdout.write(`Hive Android daemon listening on ${host}:${port}\n`);
      const interfacesByAddress = new Map(listPrivateIpv4Addresses().map(({ name, address }) => [address, name]));
      for (const endpoint of endpoints) {
        const interfaceName = interfacesByAddress.get(new URL(endpoint).hostname);
        process.stdout.write(`WSS address${interfaceName ? ` (${interfaceName})` : ""}: ${endpoint}\n`);
      }
      process.stdout.write(`Certificate SHA-256: ${fingerprint}\n`);
      process.stdout.write(`Pairing token: ${token}\n`);
      resolve();
    });
  });

  subscribeDaemonEvents((event) => broadcastMobileEvent(event));
  const shutdown = (): void => {
    for (const peer of peers) closePeer(peer, 1001, "Hive daemon stopped");
    server.close();
    void stopOpenCodeProvider();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await warmOpenCodeProvider();
    process.stdout.write("OpenCode provider connected.\n");
  } catch (error) {
    process.stderr.write(`OpenCode startup failed: ${errorMessage(error)}\n`);
  }
}

function broadcastMobileEvent(event: MobileEvent): void {
  for (const peer of mobilePeers) {
    if (peer.authenticated) sendJson(peer, { type: "event", event });
  }
}

async function getMobileToken(): Promise<string> {
  const configured = process.env.HIVE_MOBILE_TOKEN?.trim();
  if (configured) {
    if (configured.length < 32) throw new Error("HIVE_MOBILE_TOKEN must contain at least 32 characters");
    return configured;
  }
  const tokenPath = join(hiveConfigDir(), "mobile-token");
  try {
    const saved = (await readFile(tokenPath, "utf8")).trim();
    if (saved.length >= 32) return saved;
  } catch { /* create a persistent token on first launch */ }
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600).catch(() => {});
  return token;
}

function getPublicEndpoints(bindHost: string, port: number, configured: string | undefined): string[] {
  if (configured) return [validateMobileEndpoint(configured)];
  if (bindHost !== "0.0.0.0" && bindHost !== "::" && bindHost !== "*") {
    return [`wss://${formatHost(bindHost)}:${port}/rpc`];
  }
  const localAddresses = listPrivateIpv4Addresses();
  if (!localAddresses.length) {
    throw new Error("No private IPv4 address was found. Set HIVE_MOBILE_PUBLIC_URL to a reachable wss://IP:port/rpc address.");
  }
  return localAddresses.map(({ address }) => `wss://${address}:${port}/rpc`);
}

function validateMobileEndpoint(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new Error("HIVE_MOBILE_PUBLIC_URL must be a valid wss:// URL ending in /rpc"); }
  if (url.protocol !== "wss:" || url.pathname !== "/rpc" || url.search || url.hash || url.username || url.password) {
    throw new Error("HIVE_MOBILE_PUBLIC_URL must use wss:// and end with /rpc");
  }
  return url.toString();
}

async function getTlsMaterial(
  endpoints: string[],
  certificatePath: string | undefined,
  privateKeyPath: string | undefined,
): Promise<{ cert: Buffer; key: Buffer; fingerprint: string }> {
  if (certificatePath && privateKeyPath) {
    const [cert, key] = await Promise.all([readFile(certificatePath), readFile(privateKeyPath)]);
    return { cert, key, fingerprint: certificateFingerprint(cert) };
  }

  const configDirectory = hiveConfigDir();
  const savedCertPath = join(configDirectory, "mobile-cert.pem");
  const savedKeyPath = join(configDirectory, "mobile-key.pem");
  let cert: Buffer | undefined;
  let key: Buffer | undefined;
  try {
    const [savedCert, savedKey] = await Promise.all([readFile(savedCertPath), readFile(savedKeyPath)]);
    const parsed = new X509Certificate(savedCert);
    const remainingMs = Date.parse(parsed.validTo) - Date.now();
    const hosts = endpoints.map((endpoint) => new URL(endpoint).hostname);
    const certificateCoversEndpoints = hosts.every((host) =>
      isIpv4(host) ? parsed.checkIP(host) !== undefined : parsed.checkHost(host) !== undefined,
    );
    if (remainingMs > 30 * 24 * 60 * 60 * 1000 && certificateCoversEndpoints) {
      cert = savedCert;
      key = savedKey;
    }
  } catch { /* create a local certificate on first launch or after expiry */ }

  if (!cert || !key) {
    const hosts = endpoints.map((endpoint) => new URL(endpoint).hostname);
    const altNames = new Map<string, { type: 2 | 7; value?: string; ip?: string }>();
    altNames.set("dns:localhost", { type: 2, value: "localhost" });
    altNames.set("ip:127.0.0.1", { type: 7, ip: "127.0.0.1" });
    for (const host of hosts) {
      if (isIpv4(host)) altNames.set(`ip:${host}`, { type: 7, ip: host });
      else altNames.set(`dns:${host}`, { type: 2, value: host });
    }
    const notBeforeDate = new Date(Date.now() - 60_000);
    const notAfterDate = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000);
    const generated = await generateSelfSigned([{ name: "commonName", value: "Hive Mobile Daemon" }], {
      keyType: "ec",
      curve: "P-256",
      algorithm: "sha256",
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [...altNames.values()] },
      ],
    });
    cert = Buffer.from(generated.cert);
    key = Buffer.from(generated.private);
    await mkdir(configDirectory, { recursive: true, mode: 0o700 });
    await writeFile(savedCertPath, cert, { mode: 0o600 });
    await writeFile(savedKeyPath, key, { mode: 0o600 });
    await Promise.all([chmod(savedCertPath, 0o600), chmod(savedKeyPath, 0o600)]);
  }

  return { cert, key, fingerprint: certificateFingerprint(cert) };
}

function certificateFingerprint(cert: Buffer): string {
  return new X509Certificate(cert).fingerprint256.replaceAll(":", "").toLowerCase();
}

function hiveConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hive");
}

function listPrivateIpv4Addresses(): Array<{ name: string; address: string }> {
  const addresses: Array<{ name: string; address: string }> = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        addresses.push({ name, address: entry.address });
      }
    }
  }
  return addresses.sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
}

function isIpv4(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts as [number, number, number, number];
  return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function parseBindAddress(value: string): { host: string; port: number } {
  const match = value.startsWith("[") ? /^\[([^\]]+)\]:(\d+)$/.exec(value) : /^(.+):(\d+)$/.exec(value);
  const port = match ? Number(match[2]) : NaN;
  if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("HIVE_MOBILE_BIND must be an address such as 0.0.0.0:4753 or [::]:4753");
  }
  return { host: match[1]!, port };
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.protocol === "capacitor:";
  } catch { return false; }
}

function secureCompare(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const actualBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function parseParams(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function receiveFrames(peer: MobilePeer, chunk: Buffer, onText: (text: string) => void | Promise<void>): void {
  if (peer.closed) return;
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  if (peer.buffer.length > MAX_FRAME_BYTES + 14) { closePeer(peer, 1009, "Message too large"); return; }
  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0]!;
    const second = peer.buffer[1]!;
    const final = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (!final || (first & 0x70) !== 0 || !masked) { closePeer(peer, 1002, "Unsupported WebSocket frame"); return; }
    if (length === 126) {
      if (peer.buffer.length < 4) return;
      length = peer.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (peer.buffer.length < 10) return;
      const largeLength = peer.buffer.readBigUInt64BE(2);
      if (largeLength > BigInt(MAX_FRAME_BYTES)) { closePeer(peer, 1009, "Message too large"); return; }
      length = Number(largeLength);
      offset = 10;
    }
    if (length > MAX_FRAME_BYTES) { closePeer(peer, 1009, "Message too large"); return; }
    if (peer.buffer.length < offset + 4 + length) return;
    const mask = peer.buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(peer.buffer.subarray(offset + 4, offset + 4 + length));
    peer.buffer = peer.buffer.subarray(offset + 4 + length);
    for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
    if (opcode === 8) { closePeer(peer, 1000, "Closed"); return; }
    if (opcode === 9) { writeFrame(peer, 10, payload); continue; }
    if (opcode === 10) continue;
    if (opcode !== 1) { closePeer(peer, 1003, "Text frames required"); return; }
    void onText(payload.toString("utf8"));
  }
}

function sendJson(peer: MobilePeer, value: unknown): void {
  if (!peer.closed && !peer.socket.destroyed) writeFrame(peer, 1, Buffer.from(JSON.stringify(value), "utf8"));
}

function writeFrame(peer: MobilePeer, opcode: number, payload: Buffer): void {
  if (peer.closed || peer.socket.destroyed) return;
  let header: Buffer;
  if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length]);
  else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  peer.socket.write(Buffer.concat([header, payload]));
}

function closePeer(peer: MobilePeer, code: number, reason: string): void {
  if (peer.closed) return;
  if (!peer.socket.destroyed) {
    const reasonBytes = Buffer.from(reason).subarray(0, 120);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0); reasonBytes.copy(payload, 2);
    writeFrame(peer, 8, payload);
    peer.socket.end();
  }
  peer.closed = true;
  mobilePeers.delete(peer);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
