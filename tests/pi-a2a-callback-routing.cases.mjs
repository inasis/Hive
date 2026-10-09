import { test } from "node:test";
import { assertPiA2ARoute, readAcknowledgement } from "./pi-a2a-test-support.mjs";

test("Pi A2A can revisit agents across callback roots", async () => {
  await assertPiA2ARoute({
    name: "A-B-C-B-A",
    next: async (piAgents, task, rootTaskId, sent) => {
      if (task.targetAgent === "worker" && task.metadata?.delivery === "a2a-async-request") {
        sent.push({ task, acknowledgement: readAcknowledgement(await piAgents.worker.call("a2a_send", {
          targetAgent: "other", message: "B sends the result to C.", responseForTaskId: task.taskId,
        })) });
      } else if (task.targetAgent === "other" && task.metadata?.delivery === "a2a-result-delivery") {
        sent.push({ task, acknowledgement: readAcknowledgement(await piAgents.other.call("a2a_send", {
          targetAgent: "worker", message: "C returns the result to B.", callbackForTaskId: task.taskId,
        })) });
      } else if (task.targetAgent === "worker" && task.metadata?.delivery === "a2a-result-callback") {
        sent.push({ task, acknowledgement: readAcknowledgement(await piAgents.worker.call("a2a_send", {
          targetAgent: "caller", message: "B returns the result to A.", callbackForTaskId: rootTaskId,
        })) });
      }
    },
    expectedTargets: ["worker", "other", "worker", "caller"],
  });

  await assertPiA2ARoute({
    name: "A-B-C-D-E-C-A",
    next: async (piAgents, task, rootTaskId, sent) => {
      const hops = {
        worker: { next: "other", message: "B sends to C." },
        other: { next: task.sourceAgent === "last" ? "caller" : "middle", message: "C continues the result path." },
        middle: { next: "last", message: "D sends to E." },
        last: { next: "other", message: "E returns to C." },
      };
      if (task.targetAgent === "other" && task.sourceAgent === "last") {
        sent.push({ task, acknowledgement: readAcknowledgement(await piAgents.other.call("a2a_send", {
          targetAgent: "caller", message: "C returns the result to A.", callbackForTaskId: rootTaskId,
        })) });
        return;
      }
      const hop = hops[task.targetAgent];
      if (!hop) return;
      sent.push({ task, acknowledgement: readAcknowledgement(await piAgents[task.targetAgent].call("a2a_send", {
        targetAgent: hop.next,
        message: hop.message,
        responseForTaskId: task.taskId,
      })) });
    },
    expectedTargets: ["worker", "other", "middle", "last", "other", "caller"],
  });
});
