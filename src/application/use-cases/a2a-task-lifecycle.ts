import {
  type TaskState,
} from "../../domain/collaboration/aggregates/task.js";
import type { TaskAggregate } from "../../domain/collaboration/aggregates/task-aggregate.js";
import type { AgentResult } from "../../domain/collaboration/aggregates/task.js";
import type { TaskRepository } from "../../domain/collaboration/repositories/task-repository.js";
import type { A2ARuntimeEvent } from "../ports/a2a-runtime.js";
import type { A2ATaskRecordDto } from "../dto/a2a-collaboration.js";
import { toA2ATaskRecordDto } from "../mappers/a2a-collaboration-mapper.js";
import type { AdapterError } from "../../domain/a2a-adapter.js";
import { isTerminalTask } from "../validation/a2a-runtime-copy.js";

type A2ATaskLifecycleDependencies = {
  tasks: TaskRepository;
  readClock(): number;
  emit(event: A2ARuntimeEvent): void;
  publishTerminalResult(record: A2ATaskRecordDto): void;
};

/** Applies task state transitions and their ordered runtime notifications. */
export class A2ATaskLifecycle {
  constructor(private readonly dependencies: A2ATaskLifecycleDependencies) {}

  finishFailure(record: TaskAggregate, error: AdapterError): void {
    record.setError(error);
    if (record.state === "QUEUED" || record.state === "RUNNING" || record.state === "WAITING") {
      this.transition(record, "FAILED");
    } else {
      this.dependencies.tasks.save(record);
    }
  }

  transition(record: TaskAggregate, next: TaskState): void {
    record.transition(next, this.dependencies.readClock());
    this.dependencies.tasks.save(record);
    const result = toA2ATaskRecordDto(record.toRecord());
    this.dependencies.emit({ type: "task.updated", task: result });
    if (isTerminalTask(next)) this.dependencies.publishTerminalResult(result);
  }

  finishWithResult(record: TaskAggregate, result: AgentResult): void {
    record.finishWithResult(result, this.dependencies.readClock());
    this.dependencies.tasks.save(record);
    const taskResult = toA2ATaskRecordDto(record.toRecord());
    this.dependencies.emit({ type: "task.updated", task: taskResult });
    this.dependencies.publishTerminalResult(taskResult);
  }

  touch(record: TaskAggregate): void {
    record.touch(this.dependencies.readClock());
    this.dependencies.tasks.save(record);
  }
}
