import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfiguredCliAgentAdapter } from "../dist/infrastructure/providers/configured-cli-agent.js";

test("configured CLI agents receive no prior A2A history or room roster", async () => {
  const adapter = new ConfiguredCliAgentAdapter({
    adapterId: "cli-test",
    provider: "custom",
    command: "/bin/cat",
    args: [],
    sessions: [{ sessionId: "cli-session", persistenceLevel: 0, runtimeManagedHistory: false }],
    promptDelivery: "stdin",
    stdinFormat: "json",
    outputFormat: "text",
    capabilities: { toolCalling: false, fileAccess: true, shellAccess: true },
    integrationStatus: "VERIFIED",
    evidence: { source: "official-cli", verifiedAt: "2026-09-29", confidence: "high", limitations: [] },
  });
  const result = await adapter.execute({
    sessionId: "cli-session",
    provider: "custom",
    persistenceLevel: 0,
    runtimeManagedHistory: false,
  }, {
    taskId: "cli-task",
    rootTaskId: "cli-task",
    roomId: "room",
    sourceAgent: "orchestrator",
    targetAgent: "cli-agent",
    type: "REQUEST",
    message: "Inspect the parser.",
    depth: 0,
    maxDepth: 4,
    timeoutMs: 5_000,
    createdAt: 1,
    visitedAgents: ["cli-agent"],
  }, {
    signal: new AbortController().signal,
    history: [{ role: "user", message: "OLD PRIVATE HISTORY" }],
    agents: [{ agentId: "other-agent", sessionName: "Other private session" }],
    async delegate() { throw new Error("unused"); },
  });
  const payload = JSON.parse(result.message);
  assert.deepEqual(payload.history, []);
  assert.match(payload.message, /Inspect the parser/);
  assert.doesNotMatch(payload.message, /OLD PRIVATE HISTORY|Other private session/);
});

test("configured CLI delegation preserves A2A response delivery and bonded A2B rules", async () => {
  async function run(task, delegation) {
    const script = [
      'let input="";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", chunk => input += chunk);',
      `process.stdin.on("end", () => { const payload = JSON.parse(input); process.stdout.write(JSON.stringify({ message: payload.message, delegations: ${JSON.stringify([delegation])} })); });`,
    ].join("");
    const adapter = new ConfiguredCliAgentAdapter({
      adapterId: "cli-delegation-test",
      provider: "custom",
      command: process.execPath,
      args: ["-e", script],
      sessions: [{ sessionId: "cli-session", persistenceLevel: 0, runtimeManagedHistory: false }],
      promptDelivery: "stdin",
      stdinFormat: "json",
      outputFormat: "json",
      delegation: { maxCallsPerTask: 1 },
      capabilities: { toolCalling: true, fileAccess: true, shellAccess: true },
      integrationStatus: "VERIFIED",
      evidence: { source: "official-cli", verifiedAt: "2026-09-29", confidence: "high", limitations: [] },
    });
    let delegated;
    const result = await adapter.execute({
      sessionId: "cli-session",
      provider: "custom",
      persistenceLevel: 0,
      runtimeManagedHistory: false,
    }, task, {
      signal: new AbortController().signal,
      history: [{ role: "user", message: "OLD PRIVATE HISTORY" }],
      agents: [{ agentId: "private-agent", sessionName: "Private room roster" }],
      async delegate(request) { delegated = request; return { task: { taskId: "accepted" } }; },
    });
    return { prompt: result.message, delegated };
  }

  const a2a = await run({
    taskId: "cli-a2a-task", rootTaskId: "cli-a2a-task", roomId: "room", sourceAgent: "caller", targetAgent: "cli-agent",
    type: "REQUEST", message: "Inspect only this module.", depth: 0, maxDepth: 4, timeoutMs: 5_000, createdAt: 1,
    visitedAgents: ["cli-agent"], metadata: { delivery: "a2a-async-request" },
  }, {
    targetSessionName: "Result reviewer", message: "The parser rejects malformed input.", responseForTaskId: "cli-a2a-task",
  });
  assert.equal(a2a.delegated.responseForTaskId, "cli-a2a-task");
  assert.match(a2a.prompt, /deliver your answer in an async delegation with responseForTaskId=cli-a2a-task/);
  assert.match(a2a.prompt, /Accepted delivery is success; do not wait for the recipient/);
  assert.doesNotMatch(a2a.prompt, /OLD PRIVATE HISTORY|Private room roster/);

  const a2b = await run({
    taskId: "cli-bonded-task", rootTaskId: "cli-bonded-task", roomId: "room", sourceAgent: "caller", targetAgent: "bonded-agent",
    type: "REQUEST", message: "Answer this directly.", depth: 0, maxDepth: 4, timeoutMs: 5_000, createdAt: 2,
    visitedAgents: ["bonded-agent"], metadata: { delivery: "a2b-bonded-request" },
  }, { targetAgent: "caller", message: "The answer is 42.", callbackForTaskId: "cli-bonded-task" });
  assert.equal(a2b.delegated.callbackForTaskId, "cli-bonded-task");
  assert.match(a2b.prompt, /Bonded A2B: answer directly as this agent; do not delegate/);
  assert.match(a2b.prompt, /callbackForTaskId=cli-bonded-task/);
});
