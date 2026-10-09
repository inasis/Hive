import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../../src/presentation/App";
import { bridgeRuntime, bridgeRpc, isDaemonClient, isMobileApp, isWindowsDesktop as browserReportsWindows } from "../../desktop/src/platform/bridge-runtime";
import { createDesktopUiRuntime } from "../../desktop/src/platform/composition/desktop-ui-runtime";
import { DaemonPairingGate } from "../../../src/presentation/DaemonPairingGate";
import { hiveTranscriptCache } from "../../desktop/src/platform/hive-transcript-cache";
import { TranscriptCacheProvider } from "../../../src/presentation/shared/transcript-cache-context";
import { DesktopUiRuntimeProvider } from "../../../src/presentation/shared/desktop-ui-runtime";
import "@xterm/xterm/css/xterm.css";
import "../../../src/presentation/styles.css";

const desktopUiRuntime = createDesktopUiRuntime();

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const embeddedHostPlatform = new URLSearchParams(window.location.search).get("hostPlatform");

function HiveRoot() {
  const [daemonMode, setDaemonMode] = useState(isDaemonClient);
  const [windowsDesktop, setWindowsDesktop] = useState(browserReportsWindows || embeddedHostPlatform === "win32");

  useEffect(() => {
    if (isMobileApp) return;
    let mounted = true;
    void bridgeRpc.request.getHostPlatform({})
      .then(({ platform }) => { if (mounted) setWindowsDesktop(platform === "win32"); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const useDaemon = () => {
    bridgeRuntime.setDesktopDaemonMode(true);
    setDaemonMode(true);
  };
  const useDirect = () => {
    bridgeRuntime.disconnectDaemonBridge();
    bridgeRuntime.setDesktopDaemonMode(false);
    setDaemonMode(false);
  };

  if (isMobileApp) {
    return <DaemonPairingGate isWindowsDesktop={windowsDesktop}>{(changePairing, renameDaemon) => <App isWindowsDesktop={windowsDesktop} onChangeDaemonSettings={changePairing} onRenameDaemon={renameDaemon} />}</DaemonPairingGate>;
  }
  if (daemonMode) {
    return <DaemonPairingGate isWindowsDesktop={windowsDesktop} onUseDirectConnection={useDirect}>{(changePairing, renameDaemon) => <App isWindowsDesktop={windowsDesktop} onChangeDaemonSettings={changePairing} onRenameDaemon={renameDaemon} onUseDirectConnection={useDirect} />}</DaemonPairingGate>;
  }
  return <App isWindowsDesktop={windowsDesktop} onUseDaemonConnection={useDaemon} />;
}

createRoot(root).render(
  <React.StrictMode>
    <DesktopUiRuntimeProvider runtime={desktopUiRuntime}>
      <TranscriptCacheProvider cache={hiveTranscriptCache}>
        <HiveRoot />
      </TranscriptCacheProvider>
    </DesktopUiRuntimeProvider>
  </React.StrictMode>,
);
