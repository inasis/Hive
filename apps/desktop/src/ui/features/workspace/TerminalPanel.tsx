import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { addUiBridgeEventListener, bridgeRpc, removeUiBridgeEventListener } from "../../bridgeClient";
import type { UiBridgeEvent } from "../../shared/bridge-event-adapter";
export function TerminalPanel({ target, cwd }: { target: string; cwd: string }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("연결 중");
  const [error, setError] = useState("");

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !target || !cwd) return;
    const sessionId = crypto.randomUUID().replaceAll("-", "_");
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Space Mono", "JetBrains Mono", "SF Mono", monospace',
      fontSize: 14,
      lineHeight: 1.35,
      scrollback: 8_000,
      theme: { background: "#080808", foreground: "#e8e8e8", cursor: "#ffffff", selectionBackground: "#494949" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    let stopped = false;
    let started = false;
    let resizeQueued = false;

    const onEvent = (event: UiBridgeEvent): void => {
      if (!("target" in event) || event.target !== target || event.threadId !== sessionId) return;
      if (event.type === "terminalData") {
        terminal.write(decodeBase64(event.data));
      } else if (event.type === "terminalReady") {
        setStatus("연결됨");
      } else if (event.type === "terminalError") {
        const message = event.message;
        setError(message);
        setStatus("오류");
        terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      } else if (event.type === "terminalExit") {
        const exitCode = event.exitCode;
        setStatus("종료됨");
        terminal.writeln(`\r\n\x1b[90m터미널 프로세스 종료${exitCode === null ? "" : ` (코드 ${exitCode})`}\x1b[0m`);
      }
    };
    addUiBridgeEventListener(onEvent);
    const onInput = terminal.onData((data) => {
      if (started && !stopped) void bridgeRpc.request.terminalInput({ target, sessionId, data: encodeBase64(data) }).catch(showError);
    });
    const resizeObserver = new ResizeObserver(() => {
      if (resizeQueued || stopped) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        if (stopped) return;
        fit.fit();
        if (started) void bridgeRpc.request.terminalResize({ target, sessionId, cols: terminal.cols, rows: terminal.rows }).catch(showError);
      });
    });
    resizeObserver.observe(element);

    void bridgeRpc.request.terminalStart({ target, cwd, sessionId, cols: terminal.cols, rows: terminal.rows })
      .then(() => {
        if (stopped) {
          void bridgeRpc.request.terminalStop({ target, sessionId });
          return;
        }
        started = true;
        setStatus("연결됨");
        terminal.focus();
      })
      .catch(showError);

    function showError(reason: unknown): void {
      const message = errorMessage(reason);
      setError(message);
      setStatus("오류");
      terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
    }
    return () => {
      stopped = true;
      resizeObserver.disconnect();
      onInput.dispose();
      removeUiBridgeEventListener(onEvent);
      terminal.dispose();
      void bridgeRpc.request.terminalStop({ target, sessionId }).catch(() => undefined);
    };
  }, [target, cwd]);

  if (!cwd) return <div className="workspace-panel-empty"><h2>작업 공간을 선택하세요</h2><p>세션을 열면 해당 경로에서 원격 터미널을 시작할 수 있습니다.</p></div>;
  return <section className="terminal-panel">
    <div className="panel-header"><div><b>원격 셸</b><span>{cwd}</span></div><span className={`panel-status ${status === "연결됨" ? "ready" : ""}`}><i />{status}</span></div>
    {error && <div className="panel-error">{error}</div>}
    <div className="terminal-screen" ref={elementRef} />
  </section>;
}
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
