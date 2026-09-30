import assert from "node:assert/strict";
import { test } from "node:test";
import { A2AHttpServer } from "../dist/adapters/transport/a2a-http-server.js";
import { InMemoryA2ARuntimeStateStore } from "../dist/adapters/persistence/a2a-runtime-state.js";
import { InMemoryA2AWorkspaceLockManager } from "../dist/adapters/workspace/a2a-locks.js";
import { A2ARuntime } from "../dist/application/use-cases/a2a-runtime.js";
import { isA2ARuntimeSnapshot } from "../dist/domain/a2a.js";

const capabilities = {
  discoverSessions: true,
  attachExistingProcess: false,
  resumeSession: false,
  persistentContext: false,
  structuredOutput: false,
  streaming: false,
  cancellation: true,
  toolCalling: true,
  fileAccess: false,
  shellAccess: false,
  delegation: true,
  concurrentTasks: false,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createHarness({
  agentIds = ["caller", "worker", "other"],
  provider = "custom",
  execute = async (_session, task) => ({ taskId: task.taskId, agentId: task.targetAgent, status: "COMPLETED", message: "done" }),
  createSession,
  workspace,
  promptAddress = false,
  permissionHandling = "preserve-target",
  getPermissionProfile,
  isAvailable = async () => true,
  canDelegateForSession = () => true,
} = {}) {
  const summaries = [];
  const stateStore = new InMemoryA2ARuntimeStateStore();
  const adapter = {
    adapterId: "test-adapter",
    provider,
    integrationStatus: "VERIFIED",
    permissionHandling,
    capabilities,
    evidence: { source: "hive-provider-port", verifiedAt: "2026-09-30", confidence: "high", limitations: [] },
    async discoverSessions() { return []; },
    async isAvailable(session) { return isAvailable(session); },
    canDelegate(session) { return canDelegateForSession(session); },
    async execute(session, task, context) { return execute(session, task, context); },
    async resume(session, input, context) { return execute(session, input.task, context); },
    async getPermissionProfile(session, activeTask) { return getPermissionProfile?.(session, activeTask); },
    canInheritPermissionProfile() { return true; },
    async cancel() {},
    ...(createSession ? { createSession } : {}),
    ...(promptAddress ? { getPromptAddress(session) { return { target: "local", threadId: session.sessionId }; } } : {}),
  };
  let id = 0;
  const runtime = new A2ARuntime({
    adapters: [adapter],
    stateStore,
    workspaceLocks: new InMemoryA2AWorkspaceLockManager(),
    createId: (kind) => `${kind}-${++id}`,
    now: () => Date.now(),
    publishAssistantEvent(event) { summaries.push(event); },
  });
  await runtime.initialize();
  await runtime.createRoom("room", "A2A async test");
  for (const agentId of agentIds) {
    await runtime.registerAgent("room", {
      agentId,
      adapterId: adapter.adapterId,
      session: {
        sessionId: `session:${agentId}`,
        provider,
        ...(workspace ? { workspace } : createSession ? { workspace: "/project" } : {}),
        persistenceLevel: 0,
        runtimeManagedHistory: false,
      },
    });
  }
  return { runtime, adapter, stateStore, summaries };
}

function resultFor(task, message) {
  return { taskId: task.taskId, agentId: task.targetAgent, status: "COMPLETED", message };
}

function waitForSignal(promise, label, inspect) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not occur: ${JSON.stringify(inspect())}`)), 1_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitForTerminal(runtime, taskId, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    let timer;
    let unsubscribe = () => {};
    const finish = (record) => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(record);
    };
    unsubscribe = runtime.subscribe((event) => {
      if (event.type !== "task.updated" || event.task.task.taskId !== taskId) return;
      if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(event.task.state)) finish(event.task);
    });
    timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Task ${taskId} did not finish: ${JSON.stringify(runtime.getTask(taskId))}`));
    }, timeoutMs);
    const current = runtime.getTask(taskId);
    if (current && ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(current.state)) finish(current);
  });
}

function faultCode(error) {
  return error?.detail?.code;
}

test("A2A and A2B senders receive acceptance while provider work is still running", async () => {
  for (const interaction of ["A2A", "A2B"]) {
    const started = deferred();
    const blocked = deferred();
    const { runtime } = await createHarness({
      execute: async (_session, task) => {
        if (task.targetAgent === "worker") {
          started.resolve();
          return blocked.promise;
        }
        return resultFor(task, "unexpected caller task");
      },
    });

    const accepted = await runtime.sendFromAgent("caller", {
      interaction,
      targetAgent: "worker",
      message: `async ${interaction} request`,
    });
    await started.promise;
    assert.equal(accepted.task.targetAgent, "worker");
    assert.equal(accepted.task.metadata.delivery, interaction === "A2A" ? "a2a-async-request" : "a2b-bonded-request");
    assert.equal(runtime.getTask(accepted.task.taskId).state, "RUNNING");

    const cancelled = await runtime.cancelTask(accepted.task.taskId);
    assert.equal(cancelled.state, "CANCELLED");
    blocked.resolve(resultFor(accepted.task, "late provider result"));
  }
});

test("task adapters receive only the source and target from a large room", async () => {
  const seenAgents = [];
  const callbackAccepted = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "worker", ...Array.from({ length: 100 }, (_, index) => `room-agent-${index}`)],
    execute: async (_session, task, context) => {
      seenAgents.push(context.agents.map((agent) => agent.agentId).sort());
      if (task.metadata?.delivery === "a2a-async-request") {
        const callback = await runtime.sendFromAgent("worker", {
          targetAgent: "caller",
          callbackForTaskId: task.taskId,
          message: "Result delivered.",
        });
        callbackAccepted.resolve(callback.task.taskId);
      }
      return resultFor(task, "Task completed.");
    },
  });
  runtime = harness.runtime;

  const accepted = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Inspect one module." });
  assert.equal((await runtime.waitForTask(accepted.task.taskId, 1_000)).state, "COMPLETED");
  const callbackTaskId = await callbackAccepted.promise;
  assert.equal((await runtime.waitForTask(callbackTaskId, 1_000)).state, "COMPLETED");
  assert.deepEqual(seenAgents, [["caller", "worker"], ["caller", "worker"]]);
});

test("A2A does not spend a provider turn on targets that cannot deliver a response", async () => {
  let executed = false;
  const { runtime } = await createHarness({
    canDelegateForSession: (session) => session.sessionId !== "session:worker",
    execute: async (_session, task) => {
      executed = true;
      return resultFor(task, "This target cannot send an A2A response.");
    },
  });

  await assert.rejects(
    () => runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Inspect one module." }),
    (error) => faultCode(error) === "NO_AGENT_AVAILABLE",
  );
  assert.equal(executed, false);
});

test("Nested A2A permission inheritance uses the active caller task", async () => {
  const childAccepted = deferred();
  const releaseParent = deferred();
  const permissionRead = deferred();
  let runtime;
  let permissionTaskId;
  const harness = await createHarness({
    agentIds: ["caller", "worker"],
    permissionHandling: "inherit-caller",
    getPermissionProfile: async (_session, activeTask) => {
      permissionTaskId = activeTask?.taskId;
      permissionRead.resolve(activeTask);
      return { provider: "custom", profile: "caller-scope" };
    },
    execute: async (_session, task) => {
      if (task.metadata?.delivery === "a2a-result-callback") return resultFor(task, "Caller received the callback.");
      if (task.targetAgent === "caller") {
        const child = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Run independently." });
        childAccepted.resolve(child);
        await releaseParent.promise;
        return resultFor(task, "Caller completed without waiting for its child.");
      }
      await runtime.sendFromAgent("worker", {
        targetAgent: "caller",
        callbackForTaskId: task.taskId,
        message: "Child result delivered to caller.",
      });
      return resultFor(task, "Child completed.");
    },
  });
  runtime = harness.runtime;

  const parent = await runtime.enqueueTask({ roomId: "room", targetAgent: "caller", message: "Start an A2A task." });
  const child = await childAccepted.promise;
  const permissionSourceTask = await permissionRead.promise;
  assert.equal(permissionTaskId, parent.task.taskId);
  assert.equal(permissionSourceTask.targetAgent, "caller");
  releaseParent.resolve();
  assert.equal((await runtime.waitForTask(parent.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(child.task.taskId, 1_000)).state, "COMPLETED");
});

test("An A2A responder cannot succeed by only finishing with a task result", async () => {
  const executedAgents = [];
  const { runtime, summaries } = await createHarness({
    provider: "codex",
    promptAddress: true,
    execute: async (_session, task) => {
      executedAgents.push(task.targetAgent);
      return resultFor(task, "worker result");
    },
  });

  const request = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "inspect the parser" });
  const completed = await runtime.waitForTask(request.task.taskId, 1_000);
  assert.equal(completed.state, "FAILED");
  assert.equal(completed.error.code, "INVALID_REQUEST");
  assert.match(completed.error.message, /without delivering its response/);
  assert.deepEqual(executedAgents, ["worker"]);
  assert.equal(runtime.getTaskGraph(request.task.taskId).length, 1);
  const delivered = summaries.find((event) => event.type === "a2aCommunicationSummary" && event.threadId === "session:caller");
  assert.ok(delivered, "the direct caller's registered session receives the result summary");
  assert.equal(delivered.communications.some((item) => item.kind === "result" && /without delivering its response/.test(item.message)), true);
});

test("the internal adapter delegation port can mark an A2A response delivery", async () => {
  let deliveredTask;
  const { runtime } = await createHarness({
    execute: async (_session, task, context) => {
      if (task.metadata?.delivery === "a2a-async-request") {
        deliveredTask = await context.delegate({
          targetAgent: "other",
          responseForTaskId: task.taskId,
          message: "The parser rejects malformed input.",
        });
      }
      return resultFor(task, "Task completed.");
    },
  });

  const accepted = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Inspect the parser." });
  assert.equal((await runtime.waitForTask(accepted.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal(deliveredTask.task.metadata.delivery, "a2a-result-delivery");
  assert.equal(deliveredTask.task.metadata.responseForTaskId, accepted.task.taskId);
  assert.equal((await runtime.waitForTask(deliveredTask.task.taskId, 1_000)).state, "COMPLETED");
});

test("A2A can create a named target agent and deliver the task to it", async () => {
  const executions = [];
  let createdName;
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller"],
    createSession: async (source, input) => {
      createdName = input.sessionName;
      return {
        sessionId: "session:created-worker",
        provider: source.provider,
        workspace: source.workspace,
        sessionName: input.sessionName,
        persistenceLevel: 0,
        runtimeManagedHistory: false,
      };
    },
    execute: async (_session, task) => {
      executions.push(task.targetAgent);
      const callback = await runtime.sendFromAgent(task.targetAgent, {
        targetAgent: "caller",
        callbackForTaskId: task.taskId,
        message: "Created agent result.",
      });
      assert.equal(callback.task.metadata.delivery, "a2a-result-callback");
      return resultFor(task, "Response delivered to the caller.");
    },
  });
  runtime = harness.runtime;

  const accepted = await runtime.sendFromAgent("caller", { targetSessionName: "Fresh worker", message: "review this file" });
  const completed = await runtime.waitForTask(accepted.task.taskId, 1_000);
  assert.equal(createdName, "Fresh worker");
  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.result.message, "Response delivered to the caller.");
  assert.equal(runtime.listAgents("room").find((agent) => agent.agentId === accepted.task.targetAgent)?.sessionName, "Fresh worker");
  assert.deepEqual(executions, [accepted.task.targetAgent]);
});

test("A2A response delivery to an existing or new agent succeeds without waiting for the recipient", async () => {
  for (const recipient of [
    { kind: "existing", agentIds: ["origin", "responder", "recipient"], target: { targetAgent: "recipient" } },
    { kind: "new", agentIds: ["origin", "responder"], target: { targetSessionName: "Result recipient" } },
  ]) {
    const delivered = deferred();
    const recipientBlocked = deferred();
    const responseAcceptance = deferred();
    let createdSessionName;
    let runtime;
    const harness = await createHarness({
      agentIds: recipient.agentIds,
      ...(recipient.kind === "new" ? {
        createSession: async (source, input) => {
          createdSessionName = input.sessionName;
          return {
            sessionId: "session:result-recipient",
            provider: source.provider,
            workspace: source.workspace,
            sessionName: input.sessionName,
            persistenceLevel: 0,
            runtimeManagedHistory: false,
          };
        },
      } : {}),
      execute: async (_session, task) => {
        if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-async-request") {
          await assert.rejects(() => runtime.sendFromAgent("responder", {
            ...recipient.target,
            message: "Malformed result delivery.",
            responseForTaskId: "another-task",
          }), (error) => faultCode(error) === "INVALID_REQUEST");
          const accepted = await runtime.sendFromAgent("responder", {
            ...recipient.target,
            message: "Response: the parser accepts malformed input.",
            responseForTaskId: task.taskId,
          });
          responseAcceptance.resolve(accepted);
          return resultFor(task, "Response delivery accepted.");
        }
        if (task.message === "Response: the parser accepts malformed input.") {
          delivered.resolve(task);
          return recipientBlocked.promise.then(() => resultFor(task, "Recipient chose to finish."));
        }
        return resultFor(task, "unexpected task");
      },
    });
    runtime = harness.runtime;

    const request = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Inspect the parser." });
    const [responseTask, recipientTask] = await Promise.all([responseAcceptance.promise, delivered.promise]);
    const responderResult = await runtime.waitForTask(request.task.taskId, 1_000);
    assert.equal(responderResult.state, "COMPLETED", `the responder ends after ${recipient.kind}-agent delivery is accepted`);
    assert.equal(responderResult.result.message, "Response delivery accepted.");
    assert.equal(responseTask.task.targetAgent, recipientTask.targetAgent);
    assert.equal(recipientTask.sourceAgent, "responder");
    assert.equal(recipientTask.metadata.delivery, "a2a-result-delivery");
    assert.equal(recipientTask.metadata.responseForTaskId, request.task.taskId);
    if (recipient.kind === "new") assert.equal(createdSessionName, "Result recipient");
    assert.equal(runtime.getTask(responseTask.task.taskId).state, "RUNNING", `the ${recipient.kind} recipient runs independently`);

    recipientBlocked.resolve();
    const recipientResult = await runtime.waitForTask(responseTask.task.taskId, 1_000);
    assert.equal(recipientResult.result.message, "Recipient chose to finish.");
  }
});

test("An A2A response recipient can forward the result again and then finish", async () => {
  const forwarded = deferred();
  const finalRecipient = deferred();
  let intermediateTaskId;
  let runtime;
  const { runtime: createdRuntime } = await createHarness({
    agentIds: ["origin", "responder", "recipient", "final-recipient"],
    execute: async (_session, task) => {
      if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-async-request") {
        await runtime.sendFromAgent("responder", {
          targetAgent: "recipient",
          responseForTaskId: task.taskId,
          message: "The parser accepts malformed input.",
        });
        return resultFor(task, "Response delivery accepted.");
      }
      if (task.targetAgent === "recipient" && task.metadata?.delivery === "a2a-result-delivery") {
        intermediateTaskId = task.taskId;
        const next = await runtime.sendFromAgent("recipient", {
          targetAgent: "final-recipient",
          responseForTaskId: task.taskId,
          message: `Forwarded result: ${task.message}`,
        });
        forwarded.resolve(next);
        return resultFor(task, "Recipient chose to forward and finish.");
      }
      if (task.targetAgent === "final-recipient") {
        finalRecipient.resolve(task);
        return resultFor(task, "Final recipient chose to finish.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = createdRuntime;

  const request = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Inspect the parser." });
  const next = await forwarded.promise;
  const finalTask = await finalRecipient.promise;
  assert.equal((await runtime.waitForTask(request.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(next.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal(finalTask.metadata.delivery, "a2a-result-delivery");
  assert.equal(finalTask.metadata.responseForTaskId, intermediateTaskId);
  assert.equal(finalTask.message, "Forwarded result: The parser accepts malformed input.");
  assert.equal((await runtime.waitForTask(finalTask.taskId, 1_000)).result.message, "Final recipient chose to finish.");
});

test("An A2A response recipient can return its result to the sender by callback", async () => {
  const callbackAccepted = deferred();
  const callbackStarted = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["origin", "responder", "recipient"],
    execute: async (_session, task) => {
      if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-async-request") {
        await runtime.sendFromAgent("responder", {
          targetAgent: "recipient",
          responseForTaskId: task.taskId,
          message: "The parser rejects malformed input.",
        });
        return resultFor(task, "Response delivery accepted.");
      }
      if (task.targetAgent === "recipient" && task.metadata?.delivery === "a2a-result-delivery") {
        const returned = await runtime.sendFromAgent("recipient", {
          targetAgent: "responder",
          callbackForTaskId: task.taskId,
          message: "Returning the response to its sender.",
        });
        callbackAccepted.resolve(returned);
        return resultFor(task, "Recipient chose to return the result.");
      }
      if (task.targetAgent === "responder" && task.metadata?.delivery === "a2a-result-callback") {
        callbackStarted.resolve(task);
        return resultFor(task, "Sender received the returned result.");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  const request = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Inspect the parser." });
  const callback = await callbackAccepted.promise;
  const callbackTask = await callbackStarted.promise;
  assert.equal((await runtime.waitForTask(request.task.taskId, 1_000)).state, "COMPLETED");
  assert.equal(callback.task.metadata.delivery, "a2a-result-callback");
  assert.equal(callback.task.metadata.callbackForTaskId, runtime.getTaskGraph(request.task.taskId)
    .find((record) => record.task.metadata?.delivery === "a2a-result-delivery").task.taskId);
  assert.equal(callbackTask.targetAgent, "responder");
  assert.equal((await runtime.waitForTask(callback.task.taskId, 1_000)).result.message, "Sender received the returned result.");
});

test("A2A callback immediately starts one new task on the original agent", async () => {
  const callbackReceived = deferred();
  const callbackBlocked = deferred();
  const callbackAcceptance = deferred();
  const childAcceptance = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["origin", "caller", "worker"],
    execute: async (_session, task) => {
      if (task.targetAgent === "caller" && (task.metadata?.delivery === "a2a-async-request" || task.message === "Start the caller task.")) {
        const child = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Inspect the parser." });
        childAcceptance.resolve(child);
        return resultFor(task, "caller continued without the child result");
      }
      if (task.targetAgent === "worker" && task.metadata?.delivery === "a2a-async-request") {
        const attempts = await Promise.allSettled([
          runtime.sendFromAgent("worker", {
            targetAgent: "caller",
            message: "Found the parser defect.",
            callbackForTaskId: task.taskId,
          }),
          runtime.sendFromAgent("worker", {
            targetAgent: "caller",
            message: "Duplicate callback.",
            callbackForTaskId: task.taskId,
          }),
        ]);
        assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
        const rejected = attempts.find((attempt) => attempt.status === "rejected");
        assert.equal(faultCode(rejected.reason), "INVALID_REQUEST");
        callbackAcceptance.resolve(attempts.find((attempt) => attempt.status === "fulfilled").value);
        return resultFor(task, "worker finished after callback acceptance");
      }
      if (task.targetAgent === "caller" && task.metadata?.delivery === "a2a-result-callback") {
        await assert.rejects(() => runtime.sendFromAgent("caller", {
          targetAgent: "worker",
          callbackForTaskId: task.taskId,
          message: "Do not return this callback again.",
        }), (error) => faultCode(error) === "PERMISSION_DENIED");
        callbackReceived.resolve(task);
        return callbackBlocked.promise.then(() => resultFor(task, "caller chose to continue"));
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  const rootRequest = await runtime.enqueueTask({ roomId: "room", targetAgent: "caller", message: "Start the caller task." });
  const request = await childAcceptance.promise;
  const callback = await callbackAcceptance.promise;
  assert.equal((await runtime.waitForTask(rootRequest.task.taskId, 1_000)).state, "COMPLETED");
  const callbackTask = await callbackReceived.promise;
  assert.equal(callback.task.parentTaskId, undefined, "a return callback starts a fresh task instead of creating a graph cycle");
  assert.equal(callback.task.rootTaskId, callback.task.taskId);
  assert.equal(callback.task.targetAgent, "caller");
  assert.equal(callback.task.metadata.callbackForTaskId, request.task.taskId);
  assert.match(callbackTask.message, /Original request:[\s\S]*Inspect the parser\.[\s\S]*Result:[\s\S]*Found the parser defect\./);
  assert.equal(runtime.getTask(callback.task.taskId).state, "RUNNING", "the callback task runs before a later user prompt");
  assert.equal((await runtime.waitForTask(request.task.taskId, 1_000)).state, "COMPLETED", "the responder exits without waiting for the callback recipient");

  callbackBlocked.resolve();
  const completed = await runtime.waitForTask(callback.task.taskId, 1_000);
  assert.equal(completed.result.message, "caller chose to continue");
  const snapshot = await harness.stateStore.load();
  assert.equal(isA2ARuntimeSnapshot(snapshot), true, "the independent callback root remains a valid persisted task");
});

test("A2A rejects callback IDs from another room or an earlier task", async () => {
  let runtime;
  let foreignTaskId;
  let staleTaskId;
  const harness = await createHarness({
    agentIds: ["origin", "responder", "new-source"],
    execute: async (_session, task) => {
      if (task.targetAgent === "foreign-responder" && task.metadata?.delivery === "a2a-async-request") {
        await runtime.sendFromAgent("foreign-responder", {
          targetAgent: "foreign-source",
          callbackForTaskId: task.taskId,
          message: "Foreign room response.",
        });
        return resultFor(task, "Foreign response accepted.");
      }
      if (task.targetAgent === "responder" && task.message === "Seed an old task.") {
        staleTaskId = task.taskId;
        await runtime.sendFromAgent("responder", {
          targetAgent: "origin",
          callbackForTaskId: task.taskId,
          message: "The old response.",
        });
        return resultFor(task, "Old response accepted.");
      }
      if (task.targetAgent === "responder" && task.message === "Probe invalid task IDs.") {
        const attempts = await Promise.allSettled([
          runtime.sendFromAgent("responder", {
            targetAgent: "foreign-source",
            callbackForTaskId: foreignTaskId,
            message: "Cross-room callback.",
          }),
          runtime.sendFromAgent("responder", {
            targetAgent: "origin",
            callbackForTaskId: staleTaskId,
            message: "Stale callback.",
          }),
        ]);
        assert.equal(attempts.every((attempt) => attempt.status === "rejected" && faultCode(attempt.reason) === "INVALID_REQUEST"), true);
        await runtime.sendFromAgent("responder", {
          targetAgent: "new-source",
          callbackForTaskId: task.taskId,
          message: "The current response.",
        });
        return resultFor(task, "Current response accepted.");
      }
      return resultFor(task, "Recipient finished.");
    },
  });
  runtime = harness.runtime;
  await runtime.createRoom("other-room", "Other room");
  for (const agentId of ["foreign-source", "foreign-responder"]) {
    await runtime.registerAgent("other-room", {
      agentId,
      adapterId: harness.adapter.adapterId,
      session: {
        sessionId: `session:${agentId}`,
        provider: "custom",
        persistenceLevel: 0,
        runtimeManagedHistory: false,
      },
    });
  }

  const oldRequest = await runtime.sendFromAgent("origin", { targetAgent: "responder", message: "Seed an old task." });
  assert.equal((await runtime.waitForTask(oldRequest.task.taskId, 1_000)).state, "COMPLETED");
  const foreignRequest = await runtime.sendFromAgent("foreign-source", { targetAgent: "foreign-responder", message: "Other room request." });
  foreignTaskId = foreignRequest.task.taskId;
  assert.equal((await runtime.waitForTask(foreignTaskId, 1_000)).state, "COMPLETED");
  const currentRequest = await runtime.sendFromAgent("new-source", { targetAgent: "responder", message: "Probe invalid task IDs." });
  assert.equal((await runtime.waitForTask(currentRequest.task.taskId, 1_000)).state, "COMPLETED");
});

test("A2A callback tasks remain visible when the original agent is offline", async () => {
  let callerAvailable = true;
  let callbackTaskId;
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "worker"],
    isAvailable: async (session) => session.sessionId !== "session:caller" || callerAvailable,
    execute: async (_session, task) => {
      if (task.targetAgent === "worker" && task.metadata?.delivery === "a2a-async-request") {
        callerAvailable = false;
        const callback = await runtime.sendFromAgent("worker", {
          targetAgent: "caller",
          callbackForTaskId: task.taskId,
          message: "Offline caller result.",
        });
        callbackTaskId = callback.task.taskId;
        return resultFor(task, `Callback accepted as ${callback.task.taskId}.`);
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  const request = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Run and callback." });
  const responder = await runtime.waitForTask(request.task.taskId, 1_000);
  const callback = await runtime.waitForTask(callbackTaskId, 1_000);
  assert.equal(responder.state, "COMPLETED", "accepted callback delivery is enough for the responder to finish");
  assert.equal(callback.state, "FAILED");
  assert.equal(callback.error.code, "SESSION_NOT_FOUND");
});

test("A2A child acquires the shared workspace after its sender finishes", async () => {
  const parentStarted = deferred();
  const childAccepted = deferred();
  const childStarted = deferred();
  const releaseParent = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "worker"],
    workspace: "/project",
    execute: async (_session, task) => {
      if (task.targetAgent === "caller" && task.message === "Hold shared workspace.") {
        parentStarted.resolve();
        const child = await runtime.sendFromAgent("caller", { targetAgent: "worker", message: "Run after parent." });
        childAccepted.resolve(child);
        await releaseParent.promise;
        return resultFor(task, "Parent finished without waiting for child.");
      }
      if (task.targetAgent === "caller" && task.metadata?.delivery === "a2a-result-callback") {
        return resultFor(task, "Caller received child callback.");
      }
      assert.equal(task.targetAgent, "worker");
      await runtime.sendFromAgent("worker", {
        targetAgent: "caller",
        callbackForTaskId: task.taskId,
        message: "Child response.",
      });
      childStarted.resolve(task);
      return resultFor(task, "Child acquired the workspace.");
    },
  });
  runtime = harness.runtime;

  const parent = await runtime.enqueueTask({ roomId: "room", targetAgent: "caller", message: "Hold shared workspace." });
  try {
    await waitForSignal(parentStarted.promise, "parent execution", () => runtime.getTask(parent.task.taskId));
    const child = await waitForSignal(childAccepted.promise, "child acceptance", () => runtime.getTask(parent.task.taskId));
    assert.equal(runtime.getTask(child.task.taskId).state, "QUEUED");
    releaseParent.resolve();
    assert.equal((await runtime.waitForTask(parent.task.taskId, 1_000)).state, "COMPLETED");
    assert.equal((await childStarted.promise).targetAgent, "worker");
    assert.equal((await runtime.waitForTask(child.task.taskId, 1_000)).state, "COMPLETED");
  } finally {
    releaseParent.resolve();
  }
});

test("Workspace-queued A2A tasks can be cancelled or time out", async () => {
  const queued = deferred();
  const releaseParent = deferred();
  const childExecutions = [];
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "cancel-target", "timeout-target"],
    workspace: "/project",
    execute: async (_session, task) => {
      if (task.targetAgent === "caller" && task.message === "Hold shared workspace.") {
        const cancelled = await runtime.sendFromAgent("caller", {
          targetAgent: "cancel-target", message: "Cancel while queued.", timeoutMs: 5_000,
        });
        const timedOut = await runtime.sendFromAgent("caller", {
          targetAgent: "timeout-target", message: "Timeout while queued.", timeoutMs: 250,
        });
        queued.resolve({
          cancelled,
          timedOut,
          parentState: runtime.getTask(task.taskId).state,
          cancelledState: runtime.getTask(cancelled.task.taskId).state,
          timedOutState: runtime.getTask(timedOut.task.taskId).state,
        });
        await releaseParent.promise;
        return resultFor(task, "Parent released the workspace.");
      }
      childExecutions.push(task.targetAgent);
      return resultFor(task, "Unexpected child execution.");
    },
  });
  runtime = harness.runtime;

  const parent = await runtime.enqueueTask({ roomId: "room", targetAgent: "caller", message: "Hold shared workspace." });
  try {
    const children = await waitForSignal(queued.promise, "child queueing", () => runtime.getTask(parent.task.taskId));
    assert.equal(children.parentState, "RUNNING");
    assert.equal(children.cancelledState, "QUEUED");
    assert.equal(children.timedOutState, "QUEUED");
    const cancelled = await runtime.cancelTask(children.cancelled.task.taskId);
    const timedOut = await waitForTerminal(runtime, children.timedOut.task.taskId, 2_000);
    assert.equal(cancelled.state, "CANCELLED", JSON.stringify(cancelled));
    assert.equal(timedOut.state, "TIMED_OUT", JSON.stringify(timedOut));
    assert.deepEqual(childExecutions, []);
  } finally {
    releaseParent.resolve();
  }
  assert.equal((await runtime.waitForTask(parent.task.taskId, 1_000)).state, "COMPLETED");
});

test("A2B binds one responder, blocks MCP and internal branches, and permits its own callback", async () => {
  const callbackReceived = deferred();
  let runtime;
  const harness = await createHarness({
    agentIds: ["caller", "bonded", "other"],
    execute: async (_session, task, context) => {
      if (task.targetAgent === "bonded" && task.metadata?.delivery === "a2b-bonded-request") {
        const server = new A2AHttpServer(runtime, { host: "127.0.0.1", port: 0, bearerToken: "x".repeat(32) });
        const branch = await Promise.allSettled([
          context.delegate({ targetAgent: "other", message: "internal branch" }),
          runtime.sendFromAgent("bonded", { targetAgent: "other", message: "runtime branch" }),
          runtime.sendFromAgent("bonded", { interaction: "A2B", targetAgent: "other", message: "bonded branch" }),
          server.callMcpTool({ name: "a2a_send", arguments: {
            callerAgentId: "bonded", targetAgent: "other", message: "MCP branch",
          } }, new URL("http://127.0.0.1/mcp?provider=custom"), { headers: {} }),
        ]);
        assert.equal(branch.every((attempt) => attempt.status === "rejected" && faultCode(attempt.reason) === "PERMISSION_DENIED"), true);

        await assert.rejects(() => runtime.sendFromAgent("other", {
          targetAgent: "caller",
          message: "Impersonated A2B callback.",
          callbackForTaskId: task.taskId,
        }), (error) => faultCode(error) === "INVALID_REQUEST");

        const callback = await server.callMcpTool({ name: "a2a_send", arguments: {
          callerAgentId: "bonded",
          targetAgent: "caller",
          message: "Bonded result.",
          callbackForTaskId: task.taskId,
        } }, new URL("http://127.0.0.1/mcp?provider=custom"), { headers: {} });
        const ack = JSON.parse(callback.content[0].text);
        assert.equal(ack.accepted, true);
        return resultFor(task, "Bonded task result");
      }
      if (task.targetAgent === "caller" && task.metadata?.delivery === "a2a-result-callback") {
        callbackReceived.resolve(task);
        return resultFor(task, "caller received bonded result");
      }
      return resultFor(task, "unexpected task");
    },
  });
  runtime = harness.runtime;

  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", targetAgent: "missing", message: "not registered",
  }), (error) => faultCode(error) === "INVALID_REQUEST");
  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", targetSessionName: "Bonded title", message: "title selection is forbidden",
  }), (error) => faultCode(error) === "INVALID_REQUEST");
  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", selector: { role: "worker" }, message: "selector selection is forbidden",
  }), (error) => faultCode(error) === "INVALID_REQUEST");
  await assert.rejects(() => runtime.sendFromAgent("caller", {
    interaction: "A2B", targetAgent: "bonded", responseForTaskId: "task-1", message: "A2B cannot mark a delegated response",
  }), (error) => faultCode(error) === "INVALID_REQUEST");

  const request = await runtime.sendFromAgent("caller", {
    interaction: "A2B",
    targetAgent: "bonded",
    message: "Complete this task yourself.",
  });
  assert.equal(request.task.metadata.delivery, "a2b-bonded-request");
  const callbackTask = await callbackReceived.promise;
  assert.equal(callbackTask.sourceAgent, "bonded");
  assert.equal(callbackTask.targetAgent, "caller");
  assert.equal(callbackTask.metadata.callbackForTaskId, request.task.taskId);
  assert.equal(callbackTask.parentTaskId, undefined);
  assert.equal((await runtime.waitForTask(callbackTask.taskId, 1_000)).state, "COMPLETED");
  assert.equal((await runtime.waitForTask(request.task.taskId, 1_000)).result.message, "Bonded task result");
  assert.equal(runtime.getTaskGraph(request.task.taskId).length, 1);
});
