export type DaemonCredentialsInput = {
  endpoint: string;
  token: string;
  fingerprint: string;
};

export type NormalizedDaemonCredentials = DaemonCredentialsInput;

export function normalizeDaemonCredentials(
  credentials: DaemonCredentialsInput,
  options: { requireFingerprint?: boolean } = {},
): NormalizedDaemonCredentials {
  let url: URL;
  try {
    url = new URL(credentials.endpoint.trim());
  } catch {
    throw new Error("데몬 주소를 wss:// 형식으로 입력하세요.");
  }
  if (url.protocol !== "wss:") throw new Error("데몬 연결에는 암호화된 wss:// 주소가 필요합니다.");
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/rpc";
  if (url.pathname !== "/rpc" || url.search || url.hash || url.username || url.password || !url.hostname) {
    throw new Error("데몬 주소에는 /rpc 경로만 사용할 수 있습니다.");
  }

  const fingerprint = credentials.fingerprint.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (options.requireFingerprint !== false && !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("데몬이 출력한 SHA-256 인증서 지문 64자리를 입력하세요.");
  }
  const token = credentials.token.trim();
  if (!token) throw new Error("데몬 페어링 토큰을 입력하세요.");
  return { endpoint: url.toString(), token, fingerprint };
}
