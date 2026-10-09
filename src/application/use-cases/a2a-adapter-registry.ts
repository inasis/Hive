import type { AgentAdapter, AgentAdapterDescriptor } from "../ports/a2a-agent-adapter.js";
import { copyDescriptor } from "../validation/a2a-runtime-copy.js";
import { validateAdapterDescriptor } from "../validation/a2a-agent-validation.js";
import { runtimeFault } from "../validation/a2a-runtime-errors.js";

/** Validates, indexes, and describes the provider adapters available to A2A. */
export class A2AAdapterRegistry {
  private readonly adapterMap = new Map<string, AgentAdapter>();

  constructor(adapters: readonly AgentAdapter[]) {
    for (const adapter of adapters) {
      const { adapterId } = adapter;
      if (!adapterId || this.adapterMap.has(adapterId)) throw new Error("A2A adapter IDs must be non-empty and unique");
      validateAdapterDescriptor(adapter);
      if (adapter.capabilities.attachExistingProcess && !adapter.attach) {
        throw new Error(`Adapter ${adapterId} declares process attachment without an attach operation`);
      }
      this.adapterMap.set(adapterId, adapter);
    }
  }

  get adapters(): ReadonlyMap<string, AgentAdapter> {
    return this.adapterMap;
  }

  list(): AgentAdapterDescriptor[] {
    return [...this.adapterMap.values()].map(copyDescriptor);
  }

  require(adapterId: string): AgentAdapter {
    const adapter = this.adapterMap.get(adapterId);
    if (!adapter) throw runtimeFault("PROVIDER_UNAVAILABLE", "", "Agent adapter is unavailable", true);
    return adapter;
  }
}
