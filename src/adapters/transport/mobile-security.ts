import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { generate as generateSelfSigned } from "selfsigned";

export async function getMobileToken(configuredValue: string | undefined): Promise<string> {
  if (configuredValue) {
    if (configuredValue.length < 32) throw new Error("HIVE_MOBILE_TOKEN must contain at least 32 characters");
    return configuredValue;
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

export function getPublicEndpoints(bindHost: string, port: number, configured: string | undefined): string[] {
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

export async function getTlsMaterial(
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

export function listPrivateIpv4Addresses(): Array<{ name: string; address: string }> {
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

function certificateFingerprint(cert: Buffer): string {
  return new X509Certificate(cert).fingerprint256.replaceAll(":", "").toLowerCase();
}

function hiveConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hive");
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
