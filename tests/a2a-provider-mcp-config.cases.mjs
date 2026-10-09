import assert from "node:assert/strict";
import { test } from "node:test";
import { injectHiveA2AMcpServer } from "../dist/infrastructure/providers/opencode/a2a-mcp-config.js";
import { createKiroA2AMcpServers } from "../dist/infrastructure/providers/kiro/a2a-mcp-server.js";
import { ensurePiA2AExtension, piA2AToolsConfigured, resolvePiA2AConnection } from "../dist/infrastructure/providers/pi/a2a-tools.js";
import { PI_A2A_EXTENSION_SOURCE } from "../dist/infrastructure/providers/pi/a2a-tool-extension-source.js";
import { codexAppServerArgs } from "../dist/infrastructure/transport/codex-process-transport.js";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("Codex app-server receives the authenticated Hive A2A MCP configuration", () => {
  const previousUrl = process.env.HIVE_A2A_MCP_URL;
  const previousToken = process.env.HIVE_A2A_HTTP_TOKEN;
  const previousEnabled = process.env.HIVE_A2A_HTTP_ENABLED;
  try {
    process.env.HIVE_A2A_MCP_URL = "http://127.0.0.1:4760/mcp?existing=1";
    process.env.HIVE_A2A_HTTP_TOKEN = "x".repeat(32);
    delete process.env.HIVE_A2A_HTTP_ENABLED;
    const args = codexAppServerArgs("local");
    assert.equal(args[0], "app-server");
    assert.equal(args.includes("experimental_use_rmcp_client=true"), false);
    assert.ok(args.includes('mcp_servers.hive_a2a.url="http://127.0.0.1:4760/mcp?existing=1&provider=codex&target=local"'));
    assert.ok(args.includes('mcp_servers.hive_a2a.bearer_token_env_var="HIVE_A2A_HTTP_TOKEN"'));
    assert.ok(args.includes("mcp_servers.hive_a2a.enabled=true"));

    process.env.HIVE_A2A_HTTP_ENABLED = "false";
    assert.deepEqual(codexAppServerArgs("local"), ["app-server"]);
  } finally {
    restoreEnvironmentValue("HIVE_A2A_MCP_URL", previousUrl);
    restoreEnvironmentValue("HIVE_A2A_HTTP_TOKEN", previousToken);
    restoreEnvironmentValue("HIVE_A2A_HTTP_ENABLED", previousEnabled);
  }
});

test("OpenCode grants only the asynchronous A2A and A2B tools", () => {
  const environment = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      mcp: { servers: { existing: { type: "local", command: "agent" } } },
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
    }),
  };
  injectHiveA2AMcpServer(environment, "http://127.0.0.1:4760/mcp", "x".repeat(32));
  const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.mcp.servers.existing.command, "agent");
  assert.equal(config.mcp.servers.hivea2a.url, "http://127.0.0.1:4760/mcp");
  assert.deepEqual(
    config.permissions.filter((permission) => permission.action.startsWith("hivea2a_")),
    [
      { action: "hivea2a_a2a_send", resource: "*", effect: "allow" },
      { action: "hivea2a_a2a_reply", resource: "*", effect: "allow" },
      { action: "hivea2a_a2b_send", resource: "*", effect: "allow" },
      { action: "hivea2a_a2a_list", resource: "*", effect: "allow" },
    ],
  );
});

test("Kiro receives an authenticated Hive A2A MCP descriptor for its local session", () => {
  const savedEnvironment = Object.fromEntries(["HIVE_A2A_HTTP_ENABLED", "HIVE_A2A_HTTP_TOKEN", "HIVE_A2A_MCP_URL"]
    .map((name) => [name, process.env[name]]));
  try {
    process.env.HIVE_A2A_HTTP_ENABLED = "true";
    process.env.HIVE_A2A_HTTP_TOKEN = "x".repeat(32);
    process.env.HIVE_A2A_MCP_URL = "http://127.0.0.1:4760/mcp";
    const [server] = createKiroA2AMcpServers("hive-local://");
    assert.equal(server.name, "hive-a2a");
    const environment = Object.fromEntries(server.env.map(({ name, value }) => [name, value]));
    assert.equal(environment.HIVE_A2A_MCP_URL, "http://127.0.0.1:4760/mcp?provider=kiro&target=hive-local%3A%2F%2F");
    assert.equal(environment.HIVE_A2A_HTTP_TOKEN, "x".repeat(32));
    assert.equal(environment.HIVE_A2A_PROVIDER, "kiro");
    assert.equal(environment.HIVE_A2A_TARGET, "hive-local://");
  } finally {
    for (const [name, value] of Object.entries(savedEnvironment)) restoreEnvironmentValue(name, value);
  }
});

test("Pi A2A tools require a safe authenticated endpoint and inject all three tool names", async () => {
  const token = "x".repeat(32);
  const configured = {
    HIVE_A2A_HTTP_ENABLED: "true",
    HIVE_A2A_HTTP_TOKEN: token,
    HIVE_A2A_MCP_URL: "http://127.0.0.1:4760/mcp?existing=1",
  };
  const connection = resolvePiA2AConnection(configured);
  assert.equal(piA2AToolsConfigured(configured), true);
  assert.equal(new URL(connection.endpoint).searchParams.get("existing"), "1");
  assert.equal(new URL(connection.endpoint).searchParams.get("provider"), "pi");
  assert.equal(new URL(connection.endpoint).searchParams.get("target"), "hive-local://");
  assert.equal(connection.token, token);
  assert.equal(piA2AToolsConfigured({ ...configured, HIVE_A2A_HTTP_ENABLED: "false" }), false);
  assert.equal(piA2AToolsConfigured({ ...configured, HIVE_A2A_HTTP_TOKEN: "short" }), false);
  assert.equal(piA2AToolsConfigured({ ...configured, HIVE_A2A_MCP_URL: "http://192.168.1.2:4760/mcp" }), false);

  const directory = await mkdtemp(join(tmpdir(), "hive-pi-a2a-"));
  try {
    const path = await ensurePiA2AExtension(directory);
    const extension = await readFile(path, "utf8");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.match(extension, /register\("a2a_list"/);
    assert.match(extension, /register\("a2a_send"/);
    assert.match(extension, /register\("a2b_send"/);
    assert.match(extension, /_meta: \{ sessionID: ctx\.sessionManager\.getSessionId\(\) \}/);
    assert.doesNotMatch(extension, new RegExp(token));
    const syntax = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.match(PI_A2A_EXTENSION_SOURCE, /Authorization: "Bearer " \+ token/);
});

function restoreEnvironmentValue(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
