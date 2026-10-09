import type { AssistantProvider } from "../../../../src/domain/provider-catalog.js";
import type { ProviderConnectionCatalogGatewayPort } from "../../../../src/application/ports/provider-catalog.js";
import type { PromptRecoveryContextPort, PromptRecoveryOpenThreadRequest } from "../../../../src/application/ports/prompt-recovery.js";
import type { ProviderDisconnectGatewayPort } from "../../../../src/application/ports/provider-disconnect.js";
import type { PromptRecoveryGatewayPort } from "../../../../src/application/use-cases/send-prompt-with-recovery.js";
import type { DaemonApiRequestMap } from "../../../../src/application/dto/daemon/daemon-api.js";
import type { DesktopBridgeRuntimePort } from "../../../../src/presentation/shared/bridge-runtime";
import { bridgeRuntime } from "./bridge-runtime";

/** Adapts application gateway ports to the renderer's typed daemon bridge. */
export class DesktopDaemonGateway implements
  ProviderConnectionCatalogGatewayPort,
  ProviderDisconnectGatewayPort,
  PromptRecoveryContextPort,
  PromptRecoveryGatewayPort<DaemonApiRequestMap["sendPrompt"]> {
  constructor(private readonly bridge: DesktopBridgeRuntimePort = bridgeRuntime) {}

  connect(target: string, provider: AssistantProvider) {
    return this.bridge.bridgeRpc.request.connect({ target, provider });
  }

  async disconnect(target: string, provider: AssistantProvider): Promise<void> {
    await this.bridge.bridgeRpc.request.disconnect({ target, provider });
  }

  isDaemonClient(): boolean {
    return this.bridge.isDaemonClient;
  }

  getActiveProvider(): AssistantProvider {
    return this.bridge.getActiveAssistantProvider();
  }

  sendPrompt(request: DaemonApiRequestMap["sendPrompt"]) {
    return this.bridge.bridgeRpc.request.sendPrompt(request);
  }

  openThread(request: PromptRecoveryOpenThreadRequest) {
    return this.bridge.bridgeRpc.request.openThread(request);
  }
}
