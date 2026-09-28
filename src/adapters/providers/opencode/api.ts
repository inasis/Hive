import { Buffer } from "node:buffer";

export type OpenCodeApiVersion = "v1" | "v2";

export type OpenCodeProbeResult = {
  version?: OpenCodeApiVersion;
  unauthorized: boolean;
  lastStatus: string;
};

/** Probe the v1 and v2 health routes, including the v2 info route used by older v2 builds. */
export async function probeOpenCodeApi(
  endpoint: string,
  authorization?: string,
  timeoutMs = 1_000,
): Promise<OpenCodeProbeResult> {
  let unauthorized = false;
  let lastStatus = "OpenCode server did not become ready";
  const base = endpoint.replace(/\/+$/, "");
  const probes: { path: string; version: OpenCodeApiVersion; valid: (value: Record<string, unknown>) => boolean }[] = [
    { path: "/global/health", version: "v1", valid: (value) => value.healthy === true },
    { path: "/api/health", version: "v2", valid: (value) => value.healthy === true },
    { path: "/api/info", version: "v2", valid: (value) => typeof value.version === "string" && value.version.length > 0 },
  ];

  for (const probe of probes) {
    const headers = new Headers({ Accept: "application/json" });
    if (authorization) headers.set("Authorization", authorization);
    try {
      const response = await fetch(`${base}${probe.path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 401) {
        unauthorized = true;
        lastStatus = "OpenCode server requires Basic authentication";
        continue;
      }
      if (!response.ok) {
        lastStatus = `OpenCode health endpoint returned HTTP ${response.status}`;
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("json")) {
        lastStatus = "OpenCode returned a non-JSON health response";
        continue;
      }
      const value = asObject(await response.json().catch(() => undefined));
      if (value && probe.valid(value)) {
        return { version: probe.version, unauthorized: false, lastStatus: "OpenCode server is healthy" };
      }
      lastStatus = "OpenCode returned an invalid health response";
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
  }
  return { unauthorized, lastStatus };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function openCodeAuthorization(username: string, password: string | undefined): string | undefined {
  return password ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` : undefined;
}
