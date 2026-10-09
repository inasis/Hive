import { getDaemonToken, getPublicEndpoints, getTlsMaterial } from "./daemon-security.js";

export type WssDaemonConfiguration = {
  host: string;
  port: number;
  endpoints: string[];
  token: string;
  cert: Buffer;
  key: Buffer;
  fingerprint: string;
};

type WssDaemonEnvironment = Readonly<Record<string, string | undefined>>;
type WssDaemonConfigurationOptions = {
  publicUrl?: string;
  environment?: WssDaemonEnvironment;
};

/** Resolves environment-backed network, pairing, and TLS settings for the WSS daemon. */
export async function resolveWssDaemonConfiguration(
  { publicUrl, environment = process.env }: WssDaemonConfigurationOptions = {},
): Promise<WssDaemonConfiguration> {
  const bind = environment.HIVE_MOBILE_BIND?.trim() || "0.0.0.0:4753";
  const certificatePath = environment.HIVE_MOBILE_TLS_CERT?.trim();
  const privateKeyPath = environment.HIVE_MOBILE_TLS_KEY?.trim();
  if (Boolean(certificatePath) !== Boolean(privateKeyPath)) {
    throw new Error("Set both HIVE_MOBILE_TLS_CERT and HIVE_MOBILE_TLS_KEY, or let Hive create its local certificate");
  }
  const { host, port } = parseBindAddress(bind);
  const configuredPublicUrl = publicUrl ? publicUrl.trim() : environment.HIVE_MOBILE_PUBLIC_URL?.trim();
  const endpoints = getPublicEndpoints(host, port, configuredPublicUrl);
  const token = await getDaemonToken(environment.HIVE_MOBILE_TOKEN?.trim());
  const { cert, key, fingerprint } = await getTlsMaterial(endpoints, certificatePath, privateKeyPath);
  return { host, port, endpoints, token, cert, key, fingerprint };
}

function parseBindAddress(value: string): { host: string; port: number } {
  const match = value.startsWith("[") ? /^\[([^\]]+)\]:(\d+)$/.exec(value) : /^(.+):(\d+)$/.exec(value);
  const port = match ? Number(match[2]) : NaN;
  if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("HIVE_MOBILE_BIND must be an address such as 0.0.0.0:4753 or [::]:4753");
  }
  return { host: match[1]!, port };
}
