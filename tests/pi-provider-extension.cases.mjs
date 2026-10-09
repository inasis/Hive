import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PiSessionCatalogOperations } from "../dist/infrastructure/providers/pi/session-catalog-operations.js";
import { PiSessionConversationAdapter } from "../dist/infrastructure/providers/pi/session-conversations.js";
import { PiSessionContext } from "../dist/infrastructure/providers/pi/session-context.js";
import { LOCAL_WORKSPACE_TARGET } from "../dist/domain/workspace.js";
import { restoreEnvironment, saveEnvironment } from "./pi-a2a-test-support.mjs";
import { fakePiRpcSource } from "./pi-a2a-provider-fixture.mjs";

test("Pi provider loads the Hive extension for probe, new, and reopened RPC sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hive-pi-provider-test-"));
  const fakePi = join(directory, "fake-pi.mjs");
  const argumentLog = join(directory, "pi-arguments.jsonl");
  const oldEnvironment = saveEnvironment([
    "HIVE_A2A_HTTP_ENABLED",
    "HIVE_A2A_HTTP_TOKEN",
    "HIVE_A2A_MCP_URL",
    "HIVE_PI_BIN",
    "HIVE_PI_SESSION_DIR",
    "HIVE_PI_TEST_ARGUMENT_LOG",
  ]);
  let context;
  try {
    await writeFile(fakePi, fakePiRpcSource, "utf8");
    await chmod(fakePi, 0o700);
    process.env.HIVE_A2A_HTTP_ENABLED = "true";
    process.env.HIVE_A2A_HTTP_TOKEN = randomUUID() + randomUUID();
    process.env.HIVE_A2A_MCP_URL = "http://127.0.0.1:4760/mcp";
    process.env.HIVE_PI_BIN = fakePi;
    process.env.HIVE_PI_SESSION_DIR = join(directory, "sessions");
    process.env.HIVE_PI_TEST_ARGUMENT_LOG = argumentLog;

    context = new PiSessionContext();
    const catalogAdapter = new PiSessionCatalogOperations(context);
    const conversations = new PiSessionConversationAdapter(context, () => {});
    const catalog = await catalogAdapter.connect(LOCAL_WORKSPACE_TARGET);
    assert.equal(catalog.models[0].model, "test-provider/test-model");
    const created = await conversations.createThread(LOCAL_WORKSPACE_TARGET, {
      cwd: directory,
      model: "test-provider/test-model",
      name: "Pi A2A fixture",
      minimal: true,
    });
    const firstOpen = await conversations.openThread(LOCAL_WORKSPACE_TARGET, created.threadId, {
      includeTranscript: false,
      minimal: true,
    });
    assert.equal(firstOpen.threadId, created.threadId);

    await catalogAdapter.disconnect(LOCAL_WORKSPACE_TARGET);
    await catalogAdapter.connect(LOCAL_WORKSPACE_TARGET);
    const reopened = await conversations.openThread(LOCAL_WORKSPACE_TARGET, created.threadId, {
      includeTranscript: false,
      minimal: true,
    });
    assert.equal(reopened.threadId, created.threadId);
    await context.closeAll();

    const invocations = (await readFile(argumentLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(invocations.length >= 4, "probe, new session, reconnect probe, and reopened session must start Pi RPC");
    for (const invocation of invocations) {
      const extensionIndex = invocation.args.indexOf("--extension");
      assert.notEqual(extensionIndex, -1, "every Pi RPC process must load the A2A extension");
      const extensionPath = invocation.args[extensionIndex + 1];
      assert.equal(invocation.extensionPath, extensionPath);
      assert.match(await readFile(extensionPath, "utf8"), /register\("a2b_send"/);
      assert.equal((await stat(extensionPath)).mode & 0o777, 0o600);
    }
  } finally {
    await context?.closeAll();
    restoreEnvironment(oldEnvironment);
    await rm(directory, { recursive: true, force: true });
  }
});
