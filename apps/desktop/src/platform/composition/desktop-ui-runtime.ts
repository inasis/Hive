import { createElement } from "react";
import { SendPromptWithRecoveryUseCase } from "../../../../../src/application/use-cases/send-prompt-with-recovery.js";
import { RestoreProviderConnectionUseCase } from "../../../../../src/application/use-cases/restore-provider-connection.js";
import { RefreshProviderCatalogsUseCase } from "../../../../../src/application/use-cases/refresh-provider-catalogs.js";
import { DisconnectProviderSessionsUseCase } from "../../../../../src/application/use-cases/disconnect-provider-sessions.js";
import type { DaemonApiRequestMap } from "../../../../../src/application/dto/daemon/daemon-api.js";
import type { DesktopUiRuntime } from "../../../../../src/presentation/shared/desktop-ui-runtime";
import { BrowserTimerAdapter } from "../browser-timers";
import { ProviderRestoreSignals } from "../provider-restore-signals";
import { DesktopPromptRecoveryEventSource } from "../prompt-recovery-event-source";
import { bridgeRuntime } from "../bridge-runtime";
import { DesktopDaemonGateway } from "../desktop-daemon-gateway";
import { WindowsWindowControls } from "../../presentation/WindowsWindowControls";

/** Bind Application use cases to the concrete renderer bridge and platform adapters. */
export function createDesktopUiRuntime(): DesktopUiRuntime {
  const desktopTimers = new BrowserTimerAdapter();
  const providerRestoreSignals = new ProviderRestoreSignals(desktopTimers);
  const daemonGateway = new DesktopDaemonGateway(bridgeRuntime);
  const promptRecovery = new SendPromptWithRecoveryUseCase<DaemonApiRequestMap["sendPrompt"]>({
    context: daemonGateway,
    gateway: daemonGateway,
    events: new DesktopPromptRecoveryEventSource(bridgeRuntime),
    restoreSignals: providerRestoreSignals,
  });

  return {
    bridge: bridgeRuntime,
    renderDesktopWindowControls: (onError) => createElement(WindowsWindowControls, { onError }),
    promptRecovery,
    providerConnectionRecovery: new RestoreProviderConnectionUseCase(daemonGateway),
    providerCatalogRefresh: new RefreshProviderCatalogsUseCase(daemonGateway),
    providerSessionsDisconnect: new DisconnectProviderSessionsUseCase(daemonGateway),
  };
}
