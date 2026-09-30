import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { bridgeRpc, disconnectDaemonBridge, isDaemonClient, isMobileApp, isWindowsDesktop as browserReportsWindows, setDesktopDaemonMode } from "./ui/bridgeClient";
import { DaemonPairingGate } from "./ui/DaemonPairingGate";
import "@xterm/xterm/css/xterm.css";
import "./ui/styles.css";

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
    setDesktopDaemonMode(true);
    setDaemonMode(true);
  };
  const useDirect = () => {
    disconnectDaemonBridge();
    setDesktopDaemonMode(false);
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
    <HiveRoot />
  </React.StrictMode>,
);
