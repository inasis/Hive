import type { AssistantProvider } from "../../../domain/provider-catalog.js";
import type { ConnectionPresentation } from "../../shared/connection-presentation";

const connectionPresentations: Record<AssistantProvider, (daemonClient: boolean, providerName: string) => ConnectionPresentation> = {
  codex: (daemonClient, providerName) => ({
    pageDescription: daemonClient
      ? "페어링한 서버가 실행 중인 컴퓨터의 Codex에 연결합니다."
      : "이 컴퓨터 또는 SSH host의 Codex에 연결합니다.",
    formTitle: daemonClient ? "서버의 로컬 provider" : `${providerName} provider`,
    formDescription: daemonClient ? "작업공간, 터미널, 파일은 서버 호스트에서 처리합니다." : "세션 provider와 작업공간 host를 설정합니다.",
    formHelp: daemonClient
      ? "WSS 페어링 후 서버가 실행된 컴퓨터의 Codex CLI에 연결합니다. 새 세션, 터미널, 파일 작업도 이 컴퓨터에서 실행됩니다."
      : <>SSH host에는 Codex CLI와 공개키 로그인이 필요합니다. 비워 두면 이 컴퓨터의 Codex를 사용합니다.</>,
    providerKind: "Codex app-server",
    runtimeLabel: daemonClient ? "서버 호스트의 Codex CLI" : "로컬 또는 SSH host",
    statusDescription: daemonClient
      ? "Codex는 서버를 실행한 컴퓨터의 사용자 계정과 설정을 사용합니다."
      : "SSH 공개키 로그인으로 원격 host에 연결합니다.",
  }),
  opencode: (daemonClient, providerName) => ({
    pageDescription: `Hive ${daemonClient ? "서버" : "실행 프로세스"}에 설정된 OpenCode provider에 연결합니다. 모델 인증 정보는 OpenCode에서 관리합니다.`,
    formTitle: `${providerName} provider`,
    formDescription: "세션 provider와 작업공간 host를 설정합니다.",
    formHelp: daemonClient
      ? <>Hive 서버가 시작할 때 <code>opencode serve</code>를 실행하고 CLI가 출력한 서버 비밀번호로 자동 연결합니다. 기본 주소는 <code>http://127.0.0.1:4096</code>입니다. CLI가 PATH에 없으면 <code>HIVE_OPENCODE_BIN</code>을 지정하세요. 기존 OpenCode 서버를 사용하려면 서버에 <code>HIVE_OPENCODE_URL</code>, 필요하면 <code>HIVE_OPENCODE_USERNAME</code>과 <code>HIVE_OPENCODE_PASSWORD</code>를 설정하고 다시 시작하세요.</>
      : <>Hive 실행 프로세스가 <code>opencode serve</code>를 자동 실행하고 CLI가 출력한 서버 비밀번호로 연결합니다. 기본 주소는 <code>http://127.0.0.1:4096</code>입니다. CLI가 PATH에 없으면 <code>HIVE_OPENCODE_BIN</code>을 지정하세요. 기존 서버를 쓰려면 <code>HIVE_OPENCODE_URL</code>과 필요한 인증 변수를 설정하세요. provider API 키는 OpenCode에서 관리합니다.</>,
    providerKind: "OpenCode HTTP API",
    runtimeLabel: daemonClient ? "Hive 서버 환경" : "Hive 실행 환경",
    statusDescription: `Hive ${daemonClient ? "서버" : "실행 프로세스"}가 설정된 serve API에 연결합니다. 서버 주소와 인증은 Hive 환경 변수에서 관리합니다.`,
  }),
  pi: (daemonClient, providerName) => ({
    pageDescription: `${daemonClient ? "Hive 서버" : "Hive 실행 프로세스"}의 Pi CLI 세션을 연결합니다.`,
    formTitle: `${providerName} provider`,
    formDescription: "Pi CLI와 작업공간은 로컬 host에서 실행됩니다.",
    formHelp: <>로컬 host에 Pi CLI를 설치하고 <code>~/.pi/agent/models.json</code>에 <code>hive</code> provider를 설정하세요. CLI가 PATH에 없으면 <code>HIVE_PI_BIN</code>을 지정할 수 있습니다. Pi가 제공하는 도구 권한과 API 인증을 사용합니다. SSH 작업공간은 지원하지 않습니다.</>,
    providerKind: "Pi CLI RPC",
    runtimeLabel: daemonClient ? "서버 호스트의 Pi CLI" : "Hive 실행 host의 Pi CLI",
    statusDescription: "Pi CLI가 설치된 Hive host에서 세션과 작업공간 도구를 실행합니다.",
  }),
  kiro: (daemonClient, providerName) => ({
    pageDescription: `${daemonClient ? "Hive 서버" : "Hive 실행 프로세스"}에서 Kiro CLI 세션을 연결합니다.`,
    formTitle: `${providerName} provider`,
    formDescription: "세션 provider와 작업공간 host를 설정합니다.",
    formHelp: daemonClient
      ? "서버 호스트에 Kiro CLI를 설치하고 로그인하세요. 세션과 모델은 해당 Kiro CLI 계정에서 관리됩니다."
      : <>로컬은 비워 두거나 SSH host에 Kiro CLI를 설치하고 로그인하세요. SSH host에서는 비대화형 셸 PATH에 <code>kiro-cli</code>가 있어야 합니다. 로컬 CLI 경로를 지정하려면 Hive에 <code>HIVE_KIRO_BIN</code>을 설정하세요.</>,
    providerKind: "Kiro CLI / ACP",
    runtimeLabel: daemonClient ? "서버 호스트의 Kiro CLI" : "로컬 또는 SSH의 Kiro CLI",
    statusDescription: "Kiro CLI 로그인 정보와 모델 설정을 사용합니다. 세션 생성·불러오기·삭제는 Kiro CLI를 통해 처리합니다.",
  }),
};

/** Build provider-specific connection copy from the connection feature. */
export function getConnectionPresentation(provider: AssistantProvider, daemonClient: boolean, providerName: string): ConnectionPresentation {
  return connectionPresentations[provider](daemonClient, providerName);
}
