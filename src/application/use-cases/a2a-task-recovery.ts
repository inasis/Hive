import type { A2ATaskRecordDto } from "../dto/a2a-collaboration.js";
import { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import type { A2ARuntimeDirectoryPort } from "../ports/a2a-runtime-directory.js";
import { copyTaskRecord, isTerminalTask } from "../validation/a2a-runtime-copy.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";
import { toAgentTaskRecord } from "../mappers/a2a-collaboration-mapper.js";

type A2ATaskRecoveryDependencies = {
  directory: Pick<A2ARuntimeDirectoryPort, "getAgentNode">;
  readClock(): number;
};

/** Restores task records and marks in-flight work as interrupted by a runtime restart. */
export class A2ATaskRecovery {
  constructor(private readonly dependencies: A2ATaskRecoveryDependencies) {}

  restore(records: readonly A2ATaskRecordDto[], tasks: TaskRepository): boolean {
    let recovered = false;
    const restoredTasks: TaskAggregate[] = [];
    for (const task of records) {
      const restored = TaskAggregate.reconstitute(copyTaskRecord(toAgentTaskRecord(task)));
      if (restored.normalizeLegacyNativeRootPath()) recovered = true;
      tasks.save(restored);
      restoredTasks.push(restored);
    }

    for (const callback of restoredTasks) {
      if (callback.delivery?.value !== "a2a-result-callback" || !callback.callbackForTaskId) continue;
      const original = tasks.findById(callback.callbackForTaskId);
      if (!original) continue;
      original.restoreCallbackSubmission();
      tasks.save(original);
    }

    for (const task of restoredTasks) {
      if (!isTerminalTask(task.state)) {
        task.setError(runtimeFault(
          "PROCESS_EXITED",
          this.dependencies.directory.getAgentNode(task.task.targetAgent)?.provider ?? "",
          "Runtime restarted before this task completed",
          true,
        ).detail);
        task.transition("FAILED", this.dependencies.readClock());
        tasks.save(task);
        recovered = true;
      }
    }
    return recovered;
  }
}
