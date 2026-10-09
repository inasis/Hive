import { LOCAL_WORKSPACE_TARGET } from "../../../domain/workspace.js";

/** Merge Hive's A2A server and tool permissions into a managed OpenCode process config. */
export function injectHiveA2AMcpServer(environment: NodeJS.ProcessEnv, url: string, token: string): void {
  let config: Record<string, unknown> = {};
  const current = environment.OPENCODE_CONFIG_CONTENT?.trim();
  if (current) {
    try {
      const parsed: unknown = JSON.parse(current);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("root must be an object");
      config = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Cannot inject Hive A2A MCP into OPENCODE_CONFIG_CONTENT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const currentMcp = typeof config.mcp === "object" && config.mcp !== null && !Array.isArray(config.mcp)
    ? config.mcp as Record<string, unknown>
    : {};
  const currentServers = typeof currentMcp.servers === "object" && currentMcp.servers !== null && !Array.isArray(currentMcp.servers)
    ? currentMcp.servers as Record<string, unknown>
    : {};
  config.mcp = {
    ...currentMcp,
    servers: {
      ...currentServers,
      hivea2a: {
        type: "remote",
        url,
        oauth: false,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Hive-Provider": "opencode",
          "X-Hive-Target": LOCAL_WORKSPACE_TARGET,
        },
        disabled: false,
        codemode: false,
        timeout: { execution: 30_000 },
      },
    },
  };
  const existingPermissions = config.permissions;
  if (existingPermissions !== undefined && !Array.isArray(existingPermissions)) {
    throw new Error("Cannot inject Hive A2A tool permissions: OpenCode permissions must be an array");
  }
  config.permissions = [
    ...((existingPermissions as unknown[] | undefined) ?? []),
    { action: "hivea2a_a2a_send", resource: "*", effect: "allow" },
    { action: "hivea2a_a2a_reply", resource: "*", effect: "allow" },
    { action: "hivea2a_a2b_send", resource: "*", effect: "allow" },
    { action: "hivea2a_a2a_list", resource: "*", effect: "allow" },
  ];
  environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
}
