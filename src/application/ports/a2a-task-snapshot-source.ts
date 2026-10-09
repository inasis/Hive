import type { A2ATaskRecordDto } from "../dto/a2a-collaboration.js";

/** Reads task record DTOs needed to rebuild the existing full runtime snapshot. */
export interface A2ATaskSnapshotSource {
  readTaskRecordsForSnapshot(): readonly A2ATaskRecordDto[];
}
