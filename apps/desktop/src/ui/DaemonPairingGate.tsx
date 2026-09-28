import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { connectDaemonBridge, disconnectDaemonBridge, preferences } from "./bridgeClient";
import { PREFERENCE_KEYS } from "../shared/preferences";

type SavedPairing = { endpoint: string; token: string; fingerprint: string };

export function DaemonPairingGate({ children, onUseDirectConnection }: {
  children: (changePairing: () => void) => ReactNode;
  onUseDirectConnection?: () => void;
}) {
  const saved = readSavedPairing();
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "");
  const [token, setToken] = useState(saved?.token ?? "");
  const [fingerprint, setFingerprint] = useState(saved?.fingerprint ?? "");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!saved) return;
    let current = true;
    setConnecting(true);
    void connectDaemonBridge(saved.endpoint, saved.token, saved.fingerprint)
      .then(() => { if (current) setConnected(true); })
      .catch((reason: unknown) => { if (current) setError(errorMessage(reason)); })
      .finally(() => { if (current) setConnecting(false); });
    return () => { current = false; };
  }, []);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setConnecting(true);
    try {
      await connectDaemonBridge(endpoint, token, fingerprint);
      const pairing = { endpoint: normalizedEndpoint(endpoint), token: token.trim(), fingerprint: normalizeFingerprint(fingerprint) };
      preferences.setItem(PREFERENCE_KEYS.daemonPairing, JSON.stringify(pairing));
      setEndpoint(pairing.endpoint);
      setToken(pairing.token);
      setFingerprint(pairing.fingerprint);
      setConnected(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setConnecting(false);
    }
  };

  const changePairing = () => {
    disconnectDaemonBridge();
    preferences.removeItem(PREFERENCE_KEYS.daemonPairing);
    setConnected(false);
    setError("");
  };

  if (connected) return <>{children(changePairing)}</>;
  return <main className="mobile-pairing-screen">
    <div className="mobile-pairing-card">
      <div className="mobile-pairing-mark">H</div>
      <span className="eyebrow">HIVE DAEMON</span>
      <h1>Hive 데몬에 연결</h1>
      <p>데몬을 실행한 컴퓨터에서 출력한 WSS 주소와 인증 정보를 입력하세요. 같은 Wi-Fi에서는 데몬이 표시한 로컬 주소를 사용할 수 있습니다.</p>
      <form onSubmit={(event) => void connect(event)}>
        <label htmlFor="mobile-daemon-endpoint">데몬 WSS 주소</label>
        <input id="mobile-daemon-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="wss://192.168.0.20:4753/rpc" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <label htmlFor="mobile-daemon-fingerprint">인증서 SHA-256 지문</label>
        <input id="mobile-daemon-fingerprint" value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} placeholder="데몬이 출력한 64자리 지문" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <label htmlFor="mobile-daemon-token">페어링 토큰</label>
        <input id="mobile-daemon-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="데몬이 출력한 토큰" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        {error && <div className="mobile-pairing-error" role="alert">{error}</div>}
        <button className="dialog-primary" type="submit" disabled={!endpoint.trim() || !token.trim() || !fingerprint.trim() || connecting}>{connecting ? "연결 중…" : "데몬 연결"}</button>
      </form>
      <div className="mobile-pairing-note">주소, SHA-256 지문, 토큰은 데몬 콘솔에 표시됩니다. 연결 전에 인증서 지문을 확인합니다.</div>
      {onUseDirectConnection && <button className="pairing-alternate" type="button" onClick={onUseDirectConnection}>SSH 또는 릴레이로 직접 연결</button>}
    </div>
  </main>;
}

function readSavedPairing(): SavedPairing | undefined {
  try {
    const saved = preferences.getItem(PREFERENCE_KEYS.daemonPairing);
    if (!saved) return undefined;
    const value: unknown = JSON.parse(saved);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const pairing = value as Record<string, unknown>;
    if (typeof pairing.endpoint !== "string" || typeof pairing.token !== "string" || typeof pairing.fingerprint !== "string") return undefined;
    return { endpoint: pairing.endpoint, token: pairing.token, fingerprint: pairing.fingerprint };
  } catch {
    return undefined;
  }
}

function normalizedEndpoint(value: string): string {
  const endpoint = value.trim();
  return endpoint.endsWith("/rpc") ? endpoint : endpoint.replace(/\/$/, "") + "/rpc";
}

function normalizeFingerprint(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
