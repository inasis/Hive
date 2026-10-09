import type { AdapterError } from "../../domain/a2a-adapter.js";
import type { NativeSession } from "../../application/dto/a2a-collaboration.js";
import type { AgentAdapter } from "../ports/a2a-agent-adapter.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

/** Resolves whether an adapter exposes the operation required by a native session's persistence mode. */
export function getTaskExecutionCompatibilityError(
  session: NativeSession,
  adapter: AgentAdapter,
  provider: string,
): AdapterError | undefined {
  if (session.persistenceLevel === 2 && !adapter.capabilities.resumeSession) {
    return runtimeFault("RESUME_UNSUPPORTED", provider, "Adapter cannot resume this native session").detail;
  }
  if (session.persistenceLevel === 3 && (!adapter.capabilities.attachExistingProcess || !adapter.attach)) {
    return runtimeFault("ATTACH_UNSUPPORTED", provider, "Adapter cannot attach to this native process").detail;
  }
  return undefined;
}
