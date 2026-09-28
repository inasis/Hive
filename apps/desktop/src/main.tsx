import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { disconnectDaemonBridge, isDaemonClient, isMobileApp, setDesktopDaemonMode } from "./ui/bridgeClient";
import { DaemonPairingGate } from "./ui/DaemonPairingGate";
import "@xterm/xterm/css/xterm.css";
import "./ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

function HiveRoot() {
  const [daemonMode, setDaemonMode] = useState(isDaemonClient);
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
    return <DaemonPairingGate>{(changePairing) => <App onChangeDaemonSettings={changePairing} />}</DaemonPairingGate>;
  }
  if (daemonMode) {
    return <DaemonPairingGate onUseDirectConnection={useDirect}>{(changePairing) => <App onChangeDaemonSettings={changePairing} onUseDirectConnection={useDirect} />}</DaemonPairingGate>;
  }
  return <App onUseDaemonConnection={useDaemon} />;
}

createRoot(root).render(
  <React.StrictMode>
    <HiveRoot />
  </React.StrictMode>,
);
