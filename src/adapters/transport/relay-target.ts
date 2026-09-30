import type { HiveRelayTarget } from "./relay-types.js";

/** Parse a shared target URI: hive+tcp[s]://relay:port/<pair-id>?token=<secret>. */
export function parseHiveRelayTarget(value: string): HiveRelayTarget | undefined {
  if (!value.startsWith("hive+tcp://") && !value.startsWith("hive+tls://")) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Hive relay target URI");
  }
  const tls = url.protocol === "hive+tls:";
  if (!tls && url.protocol !== "hive+tcp:") throw new Error("Relay URI must use hive+tcp or hive+tls");
  if (url.username || url.password || url.hash) throw new Error("Relay URI must not contain user info or a fragment");
  const pairId = url.pathname.slice(1);
  const token = url.searchParams.get("token") ?? "";
  const port = Number(url.port);
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Relay URI must include a host and TCP port");
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(pairId)) throw new Error("Relay pair ID must be 8-128 letters, digits, '_' or '-'");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("Relay token must be 32-128 letters, digits, '_' or '-'");
  if (url.searchParams.size !== 1) throw new Error("Relay URI accepts only the token query parameter");
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  return { host, port, pairId, token, tls };
}
