import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { isDaemonClient, isLinuxDesktop, isMobileApp, setLinuxDaemonMode } from "./ui/bridgeClient";
import { MobilePairingGate } from "./ui/MobilePairing";
import "@xterm/xterm/css/xterm.css";
import "./ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

function HiveRoot() {
  const [daemonMode, setDaemonMode] = useState(isDaemonClient);
  const useDaemon = () => {
    setLinuxDaemonMode(true);
    setDaemonMode(true);
  };
  const useDirect = () => {
    setLinuxDaemonMode(false);
    setDaemonMode(false);
  };

  if (isMobileApp) {
    return <MobilePairingGate>{(changeDesktop) => <App onMobileDisconnect={changeDesktop} />}</MobilePairingGate>;
  }
  if (isLinuxDesktop && daemonMode) {
    return <MobilePairingGate onUseDirectConnection={useDirect}>{(changeDesktop) => <App onMobileDisconnect={changeDesktop} onUseDirectConnection={useDirect} />}</MobilePairingGate>;
  }
  if (isLinuxDesktop) {
    return <App onUseDaemonConnection={useDaemon} />;
  }
  return <App />;
}

createRoot(root).render(
  <React.StrictMode>
    <HiveRoot />
  </React.StrictMode>,
);
