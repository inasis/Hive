type JsonObject = Record<string, unknown>;

export type OpenCodeRequestQuery = { directory?: string; locationDirectory?: string };

/** Owns OpenCode HTTP authentication, timeouts, and response/error decoding. */
export class OpenCodeHttpClient {
  constructor(
    readonly baseUrl: URL,
    private readonly authorization?: string,
  ) {}

  async request(path: string, query?: OpenCodeRequestQuery, init: RequestInit = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl.toString().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
    if (query?.directory) url.searchParams.set("directory", query.directory);
    if (query?.locationDirectory) url.searchParams.set("location[directory]", query.locationDirectory);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.authorization) headers.set("Authorization", this.authorization);
    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(30_000);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      response = await fetch(url, { ...init, headers, signal });
    } catch (error) {
      throw new Error(openCodeFetchErrorMessage(error, url), { cause: error });
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 500);
      const reason = response.status === 401 ? " (Basic 인증의 사용자 이름 또는 비밀번호를 확인하세요)" : "";
      throw new Error(`OpenCode 서버 응답 오류 ${response.status}${reason}${detail ? `: ${detail}` : ""}`);
    }
    if (response.status === 204) return undefined;
    const body = await response.text();
    if (!body.trim()) return undefined;
    try { return JSON.parse(body) as unknown; }
    catch { throw new Error("OpenCode 서버가 JSON이 아닌 응답을 반환했습니다."); }
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function openCodeFetchErrorMessage(error: unknown, url: URL): string {
  const cause = error instanceof Error ? asObject(error.cause) : undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  const detail = typeof cause?.message === "string" ? cause.message : "";
  const causeText = [code, detail].filter(Boolean).join(": ");

  if (code === "ECONNREFUSED") {
    return `OpenCode 연결이 거부되었습니다${causeText ? ` (${causeText})` : ""}. Hive host에서 ${url.origin}에 OpenCode 서버가 실행 중인지 확인하세요.`;
  }
  if (["ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"].includes(code)) {
    return `OpenCode host에 연결할 수 없습니다${causeText ? ` (${causeText})` : ""}. Hive host에서 ${url.origin}에 접근할 수 있는지와 HIVE_OPENCODE_URL 설정을 확인하세요.`;
  }

  const detailText = causeText || (error instanceof Error ? error.message : String(error));
  return `OpenCode 네트워크 요청에 실패했습니다 (${detailText}). Hive host에서 ${url.origin}/api/health 응답을 확인하세요.`;
}
