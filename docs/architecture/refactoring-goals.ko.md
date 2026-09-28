# Hive 아키텍처 리팩터링 목표와 제한사항

이 문서는 Hive를 계층형/클린 아키텍처로 점진적으로 정리할 때 도달할 최종 상태와 변경 과정에서 지켜야 할 제한사항을 정의한다. 현재 코드를 설명하는 문서가 아니라, 구현과 코드 리뷰에서 판단 기준으로 사용할 목표 문서다.

## 목표

Hive의 데스크톱 앱, Android 앱, CLI, 데몬, Codex/OpenCode/Kiro 연동을 각자의 책임에 따라 분리한다. 화면이나 전송 방식이 바뀌어도 대화와 세션 규칙이 흔들리지 않고, provider가 추가되어도 모든 provider 분기와 프로토콜 처리가 한 파일에 모이지 않게 한다.

최종적으로 다음을 만족해야 한다.

- UI, CLI, 데몬, SSH, 릴레이, provider 프로토콜 간 의존성이 명시적이다.
- 핵심 모델과 사용자 동작은 React, Node/Bun API, Electrobun, SSH, WebSocket 및 provider SDK에 의존하지 않는다.
- Codex, OpenCode, Kiro는 공통 애플리케이션 동작을 제공하되, 각 provider가 지원하지 않는 기능은 정확히 표시한다.
- 동일한 세션 동작을 데스크톱/Android UI, CLI, 데몬 API에서 중복 구현하지 않는다.
- provider 추가나 프로토콜 변경 시 수정 범위가 해당 어댑터와 필요한 애플리케이션 유스케이스에 한정된다.
- 현행 기능과 저장된 연결 정보 및 클라이언트/데몬 간 통신 호환성을 유지하며 작은 단위로 전환한다.

## 목표 계층과 의존성 방향

```text
Desktop / Android UI ─┐
CLI ──────────────────┼──> Interfaces / typed contracts
Daemon API ───────────┘                 │
                                       ▼
                              Application use cases
                                │             │
                                ▼             └──> Application ports
                              Domain                    ▲
                                                        │ implements
                              Provider / infrastructure adapters
                              (Codex, OpenCode, Kiro, SSH, relay,
                               WSS, terminal, files, persistence)

Composition roots wire interfaces, use cases, and adapters for each process.
```

의존성 규칙은 다음과 같다.

1. **Domain**은 제품 용어, provider 기능, 세션/대화 모델과 순수 규칙을 소유한다. 어떤 외부 계층도 Domain을 거쳐 공통 모델을 사용한다.
2. **Application**은 사용자 동작을 유스케이스로 표현하고 필요한 외부 동작을 포트로 선언한다. provider 프로토콜이나 UI 프레임워크를 직접 호출하지 않는다.
3. **Adapters**는 Application 포트를 구현한다. 외부 응답을 검증하고 공통 모델로 변환하는 책임을 갖는다.
4. **Interfaces**는 CLI, 데몬 API, 데스크톱 브리지 등 외부 요청을 검증하고 유스케이스 호출로 변환한다. provider 프로토콜 구현을 포함하지 않는다.
5. **Composition roots**는 실행 환경별 구현을 조립하고 프로세스 수명 주기를 관리한다. 의존성 주입은 이 경계에서 수행한다.
6. 의존성은 안쪽으로 향한다. Domain과 Application에서 UI, 네트워크, 파일시스템, 프로세스 모듈을 import하지 않는다.

## 제안하는 코드 영역

아래는 책임을 설명하기 위한 목표 영역이다. 정확한 파일명이나 디렉터리 이름을 일괄 변경하는 것이 목적은 아니다.

```text
src/
  domain/                 핵심 모델, provider ID/capability, 순수 규칙
  application/
    ports/                provider, terminal, workspace, event 등의 경계
    use-cases/            세션/메시지/설정/작업공간 동작
  adapters/
    providers/
      codex/               app-server 프로토콜 및 변환
      opencode/            HTTP API 및 서버 수명 주기
      kiro/                ACP 프로토콜 및 변환
    transport/             SSH, Hive relay, daemon WSS
    workspace/             파일 접근
    terminal/              PTY와 터미널 프로세스
    persistence/           로컬 설정과 세션 메타데이터
  interfaces/
    daemon/                요청 검증, 라우팅, 응답 직렬화
    cli/                   명령행 입력/출력
    contracts/             클라이언트가 공유하는 버전 있는 타입
  composition/             daemon/CLI/desktop 프로세스별 조립

apps/
  desktop/src/
    main/                  Electrobun 호스트와 네이티브 기능
    renderer/
      features/            연결, 세션, 대화, 터미널, 파일, 설정 UI
      shared/              재사용 UI, typed bridge client
  android/                 Capacitor 앱과 플랫폼 통합
```

기존 코드의 책임을 먼저 분리하고 동작을 보존한다. 디렉터리 구조를 위 예시와 똑같이 맞추기 위한 대규모 이동은 하지 않는다.

## 최종 구성요소의 책임

### Domain

- `AssistantProvider`, provider capability, 세션, transcript item, 모델, reasoning effort, skill/command/mode 등 외부 계층에서 공유하는 개념을 정의한다.
- provider의 기능 차이를 타입과 capability로 표현한다. 모든 provider가 같은 기능을 지원한다고 가정하지 않는다.
- JSON-RPC/ACP/HTTP 응답 객체를 Domain 타입으로 사용하지 않는다.
- 파일 경로, RPC 요청 객체, WebSocket 연결처럼 외부 실행 세부사항을 모델에 노출하지 않는다.

### Application

사용자 관점의 동작을 유스케이스로 제공한다. 예를 들어 provider 조회/연결, 세션 목록·생성·열기·이름 변경·삭제·fork, 메시지 전송·steer·중단, 모델/Thinking 변경, slash command 실행, workspace 파일 조회, 터미널 수명 주기 등이 해당한다.

각 유스케이스는 필요한 포트만 사용한다. 모든 기능과 provider 상태를 담는 거대한 관리자 객체 하나로 다시 합치지 않는다. streaming event는 같은 세션 화면을 벗어났다가 돌아와도 진행 상태와 순서가 유지되도록 명시적인 이벤트 계약을 사용한다.

### Provider adapters

- **Codex**: app-server 통신, thread/history 페이지 처리, turn/event 변환, 모델 및 Thinking 지원을 담당한다.
- **OpenCode**: HTTP API, 필요 시 서버 실행/종료, session/message/model 변환을 담당한다.
- **Kiro**: ACP 연결, session/mode/approval/command/skill/model 변환을 담당한다. 생성 가능한 권한 프리셋 선택지와 설명도 provider catalog 응답으로 제공해 UI가 Kiro 정책 ID나 문구를 소유하지 않게 한다.
- 외부 protocol DTO와 오류는 어댑터 안에 둔다. 외부 입력은 `unknown`으로 받고 경계에서 검증한다.
- capability에 따라 지원하지 않는 동작을 명확한 결과/오류로 돌려준다. 다른 provider의 동작을 억지로 모방하지 않는다.

### Infrastructure adapters

SSH, Hive TCP relay 및 종단 간 암호화 스트림, daemon WSS 인증·인증서 지문 확인, PTY, workspace 파일 접근, 로컬 설정 저장 등 운영체제와 네트워크에 묶인 기능을 구현한다. 이 구현은 Application 포트를 통해서만 사용한다.

### Interfaces와 UI

- daemon API, CLI, 데스크톱 브리지는 입력 검증과 유스케이스 호출, 출력 변환만 담당한다.
- IPC/API 경계의 요청·응답 타입은 가능한 한 구체적으로 선언한다. 공개 경계에서 `any`와 무검증 cast가 전파되지 않게 한다.
- React 화면은 렌더링, 사용자 입력, 화면 상태를 담당하고 provider별 프로토콜 조건문이나 원격 연결 수명 주기를 소유하지 않는다.
- 데스크톱과 Android가 공유하는 화면은 공유 UI와 명시적 플랫폼 포트를 사용한다. Electrobun 전용 네이티브 기능은 desktop main adapter에 둔다.

## 단계별 완료 기준

리팩터링은 동작 가능한 작은 변경으로 나누며, 각 단계에서 빌드 가능한 상태를 유지한다.

1. **공통 Domain 기준 확립 — 시작됨**
   - 공통 assistant 모델과 provider catalog를 분리했다.
   - 진행 중: Codex/OpenCode/Kiro 기능을 완전한 typed capability 집합으로 선언하고, UI의 이미지 첨부·턴 steer·메시지 전 모델 선택 요구·사이드 채팅 탭 영속성·reasoning·세션 생성/변경 권한 프로필·세션 모드·세션 이름 생성이 catalog를 참조하도록 연결했다. ACP workspace-file/terminal 요청은 일반 workspace 기능과 구분해 provider protocol capability로 이름을 명시했다.
   - 영구 side-chat 복원은 provider ID 목록 대신 `forks` capability를 확인한다. 연결 host를 비우면 provider에 상관없이 로컬 workspace target을 사용해 Codex 연결 화면의 선택적 host 안내와 실제 연결 동작을 일치시켰다.
   - 현재 기준 커밋은 `9582689`, 작업 브랜치는 `refactor/layered-architecture`, 시작 변경은 `7ce5d93`이다.
   - `src/assistant-providers.ts` 임시 호환 진입점은 모든 내부 소비자를 Domain 경로로 옮긴 뒤 제거했다.
2. **Application 포트와 typed contract**
   - provider 및 workspace/terminal/event 포트를 정의한다.
   - `daemon-api-handlers.ts`의 `any` 기반 dispatch를 검증된 요청/응답 및 유스케이스 경계로 전환한다.
   - 공개 API에서 provider별 파라미터 차이와 기능 미지원 상태를 타입으로 표현한다.
   - 진행 중: CLI용 Codex 목록/보관 유스케이스와 Codex·보관소 포트를 추가했다. CLI session summary와 `hive list --json` 결과는 open-ended `Record<string, unknown>` 대신 구체적인 `CodexCliThreadRecord`를 사용한다. Provider catalog의 connect/refresh/disconnect와 session rename/delete를 각각 `ProviderCatalogPort`, `ProviderSessionPort`로 분리했다. 데스크톱 UI의 provider별 모델 catalog 상태 타입을 connection feature에 통합해 connection·session·conversation 기능 간 중복 선언을 제거했다. daemon API 요청 검증 규칙은 각 method DTO의 필수·선택 필드와 타입에 컴파일 타임으로 연결했으며, 요청 및 이미지 첨부의 미정의 필드는 경계에서 거부한다. 원격 daemon 응답은 `daemon-response.ts`의 method별 validator로 확인한 뒤 Bun client의 pending request에 전달한다. 현재 Domain/Application/Interfaces 및 desktop Bun/shared bridge 경계에서 `any` 사용은 검색되지 않는다. 직렬화된 assistant·terminal 이벤트는 `SerializedBridgeEvent` 판별 유니온으로 method와 params 형태를 연동한다.
   - 진행 중: UI 표시 여부에 그치지 않도록 named session, create permission profile, image prompt, turn steering, model/reasoning/mode/permission 변경, approval, fork, skill·slash command 동작을 해당 `Provider*UseCases`에서 capability catalog와 대조한다. 지원하지 않는 동작은 adapter 호출 전에 provider 이름이 포함된 오류로 거부한다.
   - 진행 중: Android RPC 입력도 `DaemonRequestDispatcher` 계약을 직접 사용한다. 모바일 transport는 JSON의 미검증 `params`를 보정하지 않고 공통 dispatcher에 전달해 동일한 method별 schema가 적용되도록 했다.
   - 진행 중: daemon handler는 요청의 선택적 provider를 진입점에서 기본 provider로 한 번만 정규화한다. 내부 provider 작업 handler는 확정된 provider 타입을 받는다.
3. **provider 구현 분리**
   - 중앙 handler의 Codex, OpenCode, Kiro 분기를 각각의 provider adapter/use case로 이동한다.
   - 한 provider씩 이동하고 변환 규칙, 에러 및 이벤트 의미를 보존한다.
   - 진행 중: OpenCode HTTP 인증·timeout·응답 및 오류 decoding은 opencode/http-client.ts로 분리했다. v1/v2 skill·slash command 응답 정규화와 slash 비활성 필터는 opencode/resource-catalog-mapper.ts로 옮겼다. OpenCode 세션 조회·생성·fork와 v1 메시지 응답을 `unknown`에서 검증해 좁은 provider DTO로 정규화했다. v1/v2 모델 catalog·설정 응답을 공통 모델로 변환하는 순수 규칙과 provider/model ID 파싱을 `opencode/model-mapper.ts`로, 세션·메시지 DTO 검증과 thread/transcript 변환을 `opencode/conversation-mapper.ts`로 분리했다. HTTP 세션·모델 API와 polling 기반 turn event 발행 및 timer/controller 수명 주기를 나누기 위해 감시 책임을 `opencode/turn-watcher.ts`로 옮겼고, provider의 `types.ts`에 adapter 내부 skill·command·typed event publisher를 모았다. OpenCode의 per-target 연결·세션 상태는 `session-context.ts`, catalog·세션 수명 주기, fork, skill/command, turn/settings는 각각 `session-catalog.ts`, `session-forks.ts`, `session-commands.ts`, `session-turns.ts`의 포트별 adapter가 담당하며 `session-manager.ts`는 이를 조립하고 위임하는 facade로 축소했다. Kiro ACP method facade는 `kiro/acp-connection.ts`, JSON-RPC line framing·pending request lifecycle은 `kiro/acp-rpc.ts`, local/SSH CLI와 ACP process launch는 `kiro/process.ts`, CLI 기반 세션·모델·skill 작업은 `kiro/cli.ts`가 맡는다. Kiro의 per-target ACP 연결 map, 중복 연결 방지, stale-thread 복구 metadata와 PTY 정리는 `kiro/session-context.ts`가 소유한다. Kiro 세션 목록·생성·열기·삭제와 hydration은 `kiro/session-catalog.ts`, skill·slash command는 `kiro/session-commands.ts`, prompt·turn·model·reasoning·mode·approval은 `kiro/session-turns.ts`, 연결이 닫힌 thread 재열기는 `kiro/thread-access.ts`가 담당한다. Kiro 세션 삭제는 ACP가 지원하지 않는 기능이므로, 삭제 전에 idle ACP 연결과 그 자원을 정리하고 다른 열린 thread를 disconnected로 기록해 CLI 삭제 뒤 필요할 때 다시 열도록 했다. 활성 turn이나 미해결 approval이 있으면 연결을 닫지 않고 삭제를 거부한다. Kiro side chat·response fork와 `/rewind` transcript 복원은 `kiro/session-forks.ts`로 옮겼다. Kiro `session-manager.ts`는 이 adapter들을 조립하고 공통 포트에 위임한다. 예기치 않은 ACP 프로세스 종료를 닫힌 연결로 표시하고, stale 연결을 폐기한 뒤 기존에 열려 있던 Kiro 세션을 다음 동작 전에 다시 여는 복구 경로를 추가했다. 격리된 임시 workspace에서 Kiro ACP 연결·세션 생성·프로세스 강제 종료 뒤 재열기·삭제를 확인했고 테스트 세션이 남지 않았음을 확인했다. Codex JSON-RPC 응답은 envelope와 thread-list 항목을 경계에서 검증한다. Codex thread catalog·session CRUD·desktop hydration·CLI open은 `codex/session-catalog.ts`, skill·slash command와 CLI skill 처리는 `codex/session-commands.ts`, side chat·response fork는 `codex/session-forks.ts`, prompt·turn·model·reasoning·permission은 `codex/session-turns.ts`에 분리했다. DTO 공통 검사는 `codex/protocol-utils.ts`, app-server 연결 map·동시 연결 방지·notification 구독 수명 주기는 `codex/session-context.ts`가 맡으며 `codex/session-manager.ts`는 이 어댑터들을 조립하는 facade다. server request의 approval 응답 처리는 `codex/server-requests.ts`, thread/read transcript 변환은 `codex/history-mapper.ts`가 담당한다. Codex permission preset의 ID·표시 정보와 검증은 `codex/session-metadata.ts`를 단일 출처로 삼고 connect catalog에 전달하며, UI는 세션 권한 변경 목록과 안내 문구도 provider catalog에서 읽는다. 현재 런타임 회귀 확인: 격리 OpenCode v2 세션 생성·목록·삭제; Kiro ACP 연결·세션 생성·프로세스 종료 뒤 재열기·삭제; Codex local catalog; localhost SSH의 strict host-key 검증을 통한 Codex catalog와 workspace 목록·읽기; 임시 TCP relay의 암호화된 Codex catalog와 workspace 목록·읽기; WSS 데몬의 TLS 지문·token 인증과 schema 검증 connect 응답; local·SSH·relay terminal의 ready·입력·출력·종료 흐름. 모든 provider 기능과 실제 데스크톱·Android 상호작용의 회귀 확인은 계속한다.
   - 격리 OpenCode 런타임 재확인(HTTP client/resource catalog mapper 분리 이후): OpenCode v2 서버를 별도 임시 포트·XDG 설정/데이터 경로·임시 DB·임시 workspace·더미 모델로 실행했다. `ProviderCatalogUseCases` 연결, `ProviderConversationUseCases` 세션 생성, catalog 재조회, `ProviderSessionUseCases` HTTP 삭제, 삭제 뒤 catalog 재조회에서 생성 세션이 사라지는 것을 확인했다. 세션 생성 중 skill catalog 요청과 별도 command catalog 요청도 정규화 경로를 통과했다. 기존 4096 포트 서버는 사용하지 않았고, 종료 뒤 임시 서버와 테스트 데이터를 제거했다.
   - 진행 중: Kiro ACP JSON-RPC framing은 `kiro/acp-rpc.ts`로, ACP initialization·session method facade는 `kiro/acp-connection.ts`로 나눴다. 프로세스가 예기치 않게 종료되면 종료 오류를 RPC adapter에 보관해 후속 요청이 원인을 generic closed 오류로 덮지 않게 했다.
   - 진행 중: Kiro ACP update를 transcript entry로 누적하는 순수 변환과 update kind/content 정규화를 `kiro/session-update-mapper.ts`로 분리했다. `kiro/session-events.ts`는 ACP update 구독과 application event 발행을, `kiro/session-notifications.ts`는 ACP notification을 application event로 변환하는 일을 맡는다. mode·reasoning·skill 변환은 `kiro/session-catalog-mapper.ts`, slash command 목록·인수 변환은 `kiro/session-command-mapper.ts`, 이미지 입력 검증은 `kiro/prompt-image-validator.ts`로 나눠 단일 `session-mapping.ts`를 제거했다. Codex notification/server request와 Kiro ACP update/request는 `AssistantEvent` 판별 유니온으로 정규화하고, OpenCode도 같은 application event publisher를 사용한다. 알 수 없는 provider notification은 application과 bridge에 protocol DTO로 전달하지 않는다.
   - 진행 중: Kiro ACP server request dispatcher는 승인 이벤트와 thread/workspace 검증만 담당한다. ACP 파일 요청과 workspace 상대경로 검증은 `kiro/workspace-requests.ts`, local/SSH PTY 생성·출력 제한·종료 및 release 수명 주기는 `kiro/terminal-requests.ts`로 분리했다.
   - 진행 중: Codex app-server skill catalog 조회·Codex skill DTO 해석·Pi catalog 병합은 `codex/skill-catalog.ts`로 모으고, 로컬/SSH 파일 기반 Pi skill 검색·본문 읽기는 `workspace/pi-skills.ts`로 분리했다. Codex provider API 의존성이 workspace adapter 안에 들어가 있던 `workspace/skills.ts`는 제거했다.
4. **전송·시스템 어댑터와 조립**
   - SSH, relay, WSS, PTY, 파일, persistence와 각 실행 프로세스의 조립 코드를 경계에 둔다.
   - 시작/종료와 재연결 동작을 명확히 하고 자원 정리를 한 소유자가 맡는다.
   - 진행 중: CLI 입력·출력은 `interfaces/cli`, 실행 의존성 조립은 `composition/cli.ts`로 옮겼다. Codex `resume`의 세션·턴·승인 동작은 공통 애플리케이션 유스케이스와 세션 어댑터를 사용하며, CLI에는 타입 이벤트만 전달한다. Android daemon은 `composition/mobile-daemon.ts`에서 조립하고, mobile JSON RPC 인증·요청 검증은 `interfaces/daemon/mobile-rpc.ts`, WSS framing과 인증서·토큰·endpoint 처리는 각각 transport adapter로 분리했다. Relay host의 SIGINT/SIGTERM 수명 주기는 `composition/relay-agent.ts`, 암호화된 Codex·terminal·workspace 채널 처리는 `adapters/transport/relay-agent.ts`가 맡는다. Desktop Bun bridge도 `TerminalUseCases`·`PtyTerminalAdapter`와 `WorkspaceFileUseCases`·`RoutedWorkspaceFileAdapter`를 조립해 daemon과 같은 terminal 및 workspace 규칙을 사용한다. `RoutedWorkspaceFileAdapter`는 local/SSH/relay 파일 응답의 구조와 byte count를 포트 경계에서 검증한다. SSH 요청은 원격 helper 계약에 맞춰 JSON payload를 Base64로 전달하며, localhost SSH에서 Codex catalog와 workspace 파일 목록·읽기를 확인했다. Domain의 `workspace.ts`가 provider 공통 로컬 target ID를 정의하고, `transport/workspace-target.ts`는 SSH host 검증을 담당한다. provider·workspace·terminal 어댑터와 UI는 같은 로컬 target 값을 사용하며 Codex RPC 구현에는 의존하지 않는다. Kiro의 `kiro/session-metadata.ts`는 alias·permission preset의 JSON 영속화와 검증을 맡고, ACP 연결 어댑터는 해당 파일 IO를 직접 소유하지 않는다. Codex JSON-RPC line framing, request matching·timeout·shutdown lifecycle은 `transport/codex-rpc.ts`, local process·SSH·encrypted relay 연결 및 프로세스 수명 주기는 `transport/codex-process-transport.ts`가 맡는다. Relay E2E token 기반 key exchange·peer verification은 `relay-e2e-handshake.ts`, AES-GCM record framing과 stream lifecycle은 `relay-record-stream.ts`, 두 단계를 연결하는 public adapter는 `e2e-stream.ts`가 맡는다. Android UI 연결 경계는 물리 브라우저 WebSocket/Capacitor socket 및 listener 정리의 `apps/desktop/src/platform/mobile-daemon-socket.ts`, WSS 인증·재연결의 `mobile-daemon-transport.ts`, RPC 요청 ID·timeout·응답 matching과 pending 요청 종료의 `mobile-daemon-rpc.ts`로 나뉜다. Codex/Kiro/OpenCode provider adapter는 외부 이벤트를 application `AssistantEvent` 판별 유니온으로 변환한다. `serializeAssistantEvent`는 의미 이벤트를 기존 daemon/desktop bridge `method`/`params` envelope로 바꾸며, application port 안에 raw protocol DTO를 두지 않는다. WSS 수신 경계의 `parseBridgeEvent`는 잘못된 event payload를 거부한 뒤 renderer의 typed bridge listener에 전달한다. React의 `useTransportLifecycleEvents`는 검증된 재연결 이벤트에 따라 화면의 세션 목록과 상태를 갱신한다.
   - 진행 중: CLI 명령 라우팅을 `interfaces/cli/runner.ts`에 남기고 옵션 파싱·검증을 `arguments.ts`, help와 session list 포맷을 `output.ts`로 분리했다. `CliRuntime`은 애플리케이션 작업을 호출하는 계약만 유지하며 CLI 명령, 인자, 출력 책임의 혼합을 줄였다. 기존 CLI 옵션 검증, 오류, help 및 목록 출력은 보존했고 root TypeScript 빌드가 통과했다.
   - 진행 중: 데몬 RPC 요청/응답 method schema와 bridge event wire DTO·수신 검증·직렬화를 daemon-api.ts와 daemon-events.ts로 분리했다. Desktop, Android transport, daemon composition은 필요한 계약 모듈을 직접 import하며 두 wire 경계를 서로 끌어오지 않는다.
   - 진행 중: Desktop Bun의 pinned WSS client에서 daemon request schema 확인, request ID·timeout, method별 response validation과 disconnect 시 pending 정리를 `apps/desktop/src/bun/daemon-rpc.ts`의 `BunDaemonRpcChannel`로 분리했다. `daemon-client.ts`는 socket, TLS fingerprint pin, authentication, event 수신과 reconnect를 소유한다. 기존 120초 RPC timeout과 daemon wire payload를 유지했으며 root·desktop web·Linux native desktop·Android debug 빌드가 통과했다. split 이후 Bun client의 WSS 인증·응답·재연결 runtime 회귀 확인은 남아 있다.
   - 진행 중: TCP relay의 target/channel 타입을 relay-types.ts로 옮겨 tcp-relay.ts와 e2e-stream.ts가 서로 타입을 가져오던 순환 의존을 제거했다.
   - 진행 중: `tcp-relay.ts`를 relay URI 검증(`relay-target.ts`), peer client 연결(`relay-client.ts`), broker listener/room routing(`tcp-relay-server.ts`)과 공통 wire 버전·handshake 계약(`relay-protocol.ts`)으로 분리했다. broker 서버 transport는 `AbortSignal`로 종료되고, CLI process signal 구독과 해제는 `composition/relay-server.ts`가 소유한다.
   - Relay E2E adapter 분리 뒤 임시 TCP relay에서 client/agent token 검증과 key exchange, codex/files/terminal 각 채널의 양방향 record 전송(180,321 및 131,117 byte payload), 잘못된 token 거부, 변조 record 인증 실패, truncated record 정리를 실행해 확인했다. 이 확인은 encrypted stream의 호환성을 다루며 실제 UI 및 provider session 기능 검증을 대체하지 않는다.
   - Codex process transport 분리 뒤 Codex app-server initialize/thread-list/clean shutdown을 local, localhost SSH, 임시 TCP relay와 실제 relay host Codex app-server 조합으로 확인했다. Kiro ACP도 임시 workspace에서 세션 생성, ACP 프로세스 강제 종료, 저장 세션 재열기, 세션 삭제를 확인했다. 이 검증은 provider runtime 경로를 다루며 desktop/Android 화면 상호작용 전체를 대체하지 않는다.
   - 진행 중: workspace 파일 책임을 `local-files.ts`의 로컬 파일시스템·경로 containment, `ssh-files.ts`의 SSH 프로세스·helper 계약, `relay-files.ts`의 암호화 files 채널, `workspace-file-mapper.ts`의 원격 응답 검증, `files.ts`의 target routing으로 분리했다. 크기 제한은 `file-limits.ts`에서 공유하며 relay host는 로컬 파일 adapter만 호출한다.
   - 진행 중: theme, provider·host 선택, persistent side-chat, mobile pairing 저장값의 `localStorage` IO를 `apps/desktop/src/platform/browser-preferences.ts`로 모았다. UI feature는 `shared/preferences.ts`의 typed `PreferencesPort`와 versioned key 목록만 사용하고, `bridgeClient`가 browser adapter를 연결한다. 기존 key와 JSON 저장 형식은 유지한다.
   - 진행 중: renderer `bridgeClient`가 기존 daemon/desktop wire 이벤트를 검증한 뒤 `bridge-event-adapter.ts`의 `UiBridgeEvent` 판별 유니온으로 바꾼다. wire의 `method`/`params` 형식은 그대로 유지하고, conversation·transport lifecycle·terminal 화면은 UI 이벤트만 받는다. 이벤트명과 provider DTO를 해석하는 책임은 renderer bridge adapter 한 곳에 둔다.
   - 진행 중: Application의 `TerminalEvent`는 `data`·`ready`·`error`·`exit` 판별 유니온과 `target`/`sessionId`를 사용하며 범용 `EventEnvelope`를 더 이상 가져오지 않는다. `serializeTerminalEvent`가 이를 기존 `terminal/*` bridge 이벤트로 바꿔 daemon/desktop wire 형식을 보존한다. Provider 이벤트도 semantic union으로 바꿨고 `LegacyEventWire`와 `providerExtension` raw passthrough를 제거했다. Codex/Kiro의 대화·tool·approval 동작은 interface serializer에서 bridge event로 재구성한다. 기존 UI에서 소비하지 않는 provider notification 호환성과 실제 사용자 동작은 계속 확인한다.
5. **UI의 기능별 분리**
   - 거대한 `App.tsx`를 연결, 세션, 대화 타임라인, composer, 설정, workspace 패널 등의 기능 단위로 나눈다.
   - 브리지 client, 화면 상태, UI 컴포넌트의 책임을 구분한다.
   - 진행 중: 설정 화면, 세션 모달, workspace 탭·사이드바, provider 대화 브리지 이벤트 구독, transport lifecycle 이벤트 구독, 대화 입력창과 대화 workspace, 현재 대화·모델·초안·턴 진행 화면 상태, provider capability에 따른 이미지 첨부·steer·reasoning·권한 프로필·세션 모드 표시, 세션 생성·권한 변경 UI에서 provider catalog로 전달받는 권한 프리셋 선택지·설명·완료 문구와 이미지 첨부별 세션 상태, 활성 대화 캐시와 세션 전환 복원을 맡는 `useThreadViewLifecycle`, target/provider/thread별 대화 view와 미전송 이미지 첨부의 보관·삭제를 함께 소유하는 `ThreadViewStore`, 연결 초기화·세션 삭제·thread 삭제 때 첨부 캐시도 같은 수명 주기로 정리해 `useImageAttachments`의 별도 map 공유를 제거했다. `ThreadViewStore`의 target/provider/session 키 API, 스트리밍 transcript delta의 batching·flush·세션 정리 수명 주기를 맡는 `useTranscriptDeltaBuffer`, `connection-view-lifecycle`의 연결·provider 전환·해제 시 화면 상태 초기화, `useConnectionState`·`useConnectionWorkflow`·`useAdditionalProviderThreads`의 저장된 연결/provider 설정·provider 선택·연결·해제·세션 catalog 조회와 workflow가 소유하는 daemon 자동 연결, `workspace-target-label`의 relay target 표시·마스킹, `useThemeSettings`의 테마 저장·브라우저/Android 반영, `useResponsiveWorkspaceLayout`의 화면 폭·Android visual viewport 관리, 창 제어, 연결·프로바이더 전환·목록 갱신·종료 및 연결 화면 상태, 세션 생성 dialog 상태·폴더 선택·생성·열기, 이름 변경·삭제·설정, 영구 side-chat 탭의 저장·복원, 응답 포크·사이드 대화와 채팅 탭, 메시지 전송·steer·중지·승인, slash skill·command 조회·선택과 메뉴 열기 조건·검색·필터·키보드 선택 상태, skill 페이지 검색·제공자 필터를 기능 모듈로 이동했다. Provider 연결 안내 문구와 설정 표시 타입을 `connection-presentation.tsx`·`settings-types.ts`로 분리해 `App.tsx`와 `useThemeSettings`가 설정 페이지 모듈을 가져오지 않는다. Android의 physical WebSocket/Capacitor socket과 listener 정리는 `apps/desktop/src/platform/mobile-daemon-socket.ts`, 인증·재연결 정책은 `mobile-daemon-transport.ts`, RPC pending request lifecycle은 `mobile-daemon-rpc.ts`로 나눴다. `WorkspacePageContent`는 기능 페이지 렌더링을, `AppDialogHost`는 세션·승인 대화상자와 창 크기 조절 핸들을, `WorkspaceFrame`은 shell·sidebar·topbar·파일 패널 및 반응형 레이아웃 수명을 맡는다. `App.tsx`는 UI composition root로 feature hook과 화면을 연결하고 공유 workspace/shell 상태와 view model/action을 조립한다. provider 요청, 원격 연결 수명 주기, 저장소 IO는 기능·platform 모듈에 있다. renderer 검색에서 UI의 `codex`/`opencode`/`kiro` ID 분기는 나오지 않았고, 브라우저 저장소 API 사용은 `browser-preferences.ts` 한 adapter에 모여 있다.
   - 진행 중: target/provider/thread별 transcript 변경을 캐시와 현재 선택 화면에 동기화하는 `useThreadEntryUpdates`를 conversation feature로 옮겨 `App.tsx`의 대화 상태 로직을 줄였다. transcript 변경·turn 진행에 따른 대화 자동 스크롤 ref와 effect도 `ConversationWorkspace`가 소유한다. 세션 삭제 때 thread view·draft·image attachment·turn tracking cache를 지우고, 활성 세션 삭제 후 남은 대화 화면 상태를 초기화하는 책임을 `useThreadViewLifecycle`로 옮겼다. `useSessionManagement`는 이 lifecycle 동작을 호출해 삭제와 이름 변경 흐름을 완료한다.
   - 진행 중: target/provider/thread별 draft와 진행 중인 turn ID·시작·완료·중단 추적, 활성 thread identity의 저장·정리는 `ConversationRuntime`이 소유한다. Conversation, bridge event, session fork, connection lifecycle 기능은 여러 개의 map/ref를 직접 공유하지 않고 이 store API를 사용한다. 기존에 읽히지 않던 `turnInProgress` ref도 제거했다.
   - 진행 중: provider/thread 이름, 선택 모델·reasoning 옵션, side-chat root·visible tabs, 활성 thread 실행 상태 및 원본 대화 label 계산을 `apps/desktop/src/ui/features/workspace/workspace-view-model.ts`로 이동했다. `App.tsx`는 이 selector를 통해 기능별 화면에 필요한 view model을 받는다.
   - 진행 중: 화면 page/tab/file-open 타입을 `workspace-types.ts`, slash menu union을 `slash-menu-types.ts`에 두어 feature hook이 sidebar·Composer 컴포넌트에서 타입을 가져오지 않게 했다. `WorkspacePanels.tsx`도 workspace feature로 옮겨 terminal·file UI와 workspace tab 상태를 같은 feature 경계 안에 모았다.
   - 진행 중: conversation 이벤트 hook은 thread lifecycle, turn 상태, settings, command catalog, transcript entry를 화면 동작으로 적용하고 protocol payload를 해석하지 않는다. approval 대화상자는 method/params 대신 분류된 세부 정보만 받는다. terminal·transport lifecycle 구독도 같은 typed listener를 사용한다.
   - 진행 중: 기존 `useConversationTurns`에 함께 있던 composer 제출, 실행 중 turn의 steer/중지, approval 응답을 각각 `useComposerSubmission`, `useConversationTurnControls`, `useApprovalResponse`로 분리했다. Hive 전용 `/help`, `/quit`, `/side`, `/resume`, `/skills` 흐름은 `hive-composer-commands.ts`, provider slash command catalog 조회와 실행은 `provider-composer-commands.ts`로 분리했다. `useComposerSubmission`은 입력 순서와 provider 일반 turn lifecycle을 조정하고, `App.tsx`는 기능별 hook을 조립한다. command 처리 순서, daemon RPC payload, turn 상태 전이를 보존했다. root TypeScript와 desktop web 빌드가 통과했다.
   - 진행 중: `useSessionForks`를 제거하고 완료 응답의 영구 fork는 `useResponseFork`, provider side-chat 생성과 초기 prompt는 `useSideChatCreation`, 이미 열린 대화 탭 전환·닫기는 `useChatTabNavigation`으로 분리했다. 탭 탐색 hook에는 provider fork/create 요청과 turn 상태 setter를 전달하지 않는다. 기존 fork 요청·session hydration·첫 prompt·탭 복원 흐름은 유지했다. 이 분리 뒤 root TypeScript, desktop web, Linux native desktop, Android debug 빌드가 통과했다. 실제 UI fork/탭 흐름 검증은 남아 있다.
   - 진행 중: `useSessionWorkflows`에서 기존 thread를 여는 `useThreadOpening`과 폴더 선택·새 세션 dialog·provider session 생성을 맡는 `useSessionCreation`을 분리했다. workflow facade는 두 hook을 조립하고 기존 반환 계약을 유지한다. 새 세션 생성은 열린 thread 작업 중일 때 계속 차단하며, thread 열기의 provider 전환·catalog hydration·view 활성화 의미를 보존했다. root TypeScript, desktop web, Linux native desktop, Android debug 빌드가 통과했다. Codex/OpenCode/Kiro thread 열기와 새 세션 생성의 실제 UI 회귀는 남아 있다.
   - 진행 중: GTK titlebar 설정·장식과 native pointer 기반 frame resize 수명을 분리했다. `useWindowResize`는 pointer capture, animation-frame coalescing, native frame RPC, release cleanup을 소유하고, `useWindowControls`는 GTK appearance·titlebar controls를 소유한다. resize edge 계약은 `window-resize-types.ts`로 분리해 dialog overlay가 hook 구현을 import하지 않는다. root TypeScript, desktop web, Linux native desktop, Android debug 빌드가 통과했다. pointer drag에 따른 실제 창 크기 조절은 desktop 런타임에서 확인해야 한다.
   - conversation workspace의 자동 스크롤, workspace file adapter, Codex/Pi skill catalog, TCP relay client/server, Kiro ACP framing·session mapping, Android daemon RPC pending-request 및 physical socket 경계, Codex process transport, Relay E2E handshake와 encrypted record stream 분리 후 root TypeScript, desktop web, native Linux desktop, Android debug 전체 빌드가 통과했다. renderer bundle size, GTK deprecated API, Android Gradle/npm 경고는 남아 있으나 빌드는 성공했다. 실제 relay 암복호화·연결 재개와 desktop/Android 화면 기능 흐름 검증은 남아 있다.
6. **호환 계층 정리**
   - 이전 경로의 re-export와 임시 변환 코드는 모든 소비자가 새 경로로 이동한 뒤 제거한다.
   - 현재 코드와 문서에 남은 레거시 명칭 및 중복 타입을 확인한다.
   - 진행 중: 이전 provider·daemon·transport 구현의 최상위 파일과 임시 `assistant-providers` 진입점을 제거했다. Bridge event 소비자도 새 daemon-events.ts 경로로 이동해 RPC 계약 모듈의 이벤트 재수출을 두지 않는다. package `bin`이 가리키는 `src/cli.ts`는 `composition/cli.ts`를 실행하는 실제 진입점이므로 유지한다. 현재 `src`와 `apps/desktop/src`의 208개 TypeScript 소스를 TypeScript AST로 확인했다. runtime local import/export edge 386개와 전체 static local import/export edge 784개에서 순환 0건, Domain/Application의 상위 계층 및 외부 패키지 import 0건, Interfaces→Adapters/Composition 위반 0건, UI→desktop main 위반 0건이다. 해결되지 않은 상대 경로는 `main.tsx`의 CSS asset import 1건이며 TypeScript 모듈이 아니다. 저장소 전체에서 삭제한 최상위 모듈 경로를 import하는 코드는 남아 있지 않다. Desktop Bun client의 RPC pending lifecycle은 `daemon-rpc.ts`로 옮겼고 TLS pin 및 reconnect는 socket adapter에 남겼다. Desktop WSS와 저장 데이터·wire 호환성의 변경 후 runtime 회귀 확인은 계속 진행한다. provider 설정 도움말은 각 연결 방법을 설명하기 위해 화면에 남기고, 일반 세션·대화 기능의 Kiro/OpenCode 분기와 Kiro 전용 프리셋 문구는 catalog/capability 및 provider 표시 이름으로 대체했다.

단계 완료 시 root TypeScript 빌드와 데스크톱 웹 빌드를 확인한다. 사용자 동작에 영향을 주는 provider/연결 변경은 Codex, OpenCode, Kiro와 로컬·SSH·relay·daemon 경로 중 해당하는 회귀 시나리오를 확인한 뒤 완료 처리한다.

## 제한사항과 변경 불가 조건

### 구조와 독립 구현

- Paseo의 내부 디렉터리 구조, 데이터 모델, 코드, 고유 UX 구성을 복제하지 않는다. 공개 동작을 참고하더라도 Hive의 도메인과 경계에 맞게 독립 설계한다.
- pi/OpenCode/Codex 저장소는 동작과 공개 프로토콜을 조사하는 참고 자료로 사용할 수 있다. 소스 코드를 옮기거나 구조를 그대로 따라가기 전에 해당 버전의 라이선스를 확인하고 출처·고지 의무를 검토한다.
- Hive 구현은 BSD-2-Clause를 유지한다. 새 의존성 또는 재사용 코드의 라이선스가 저장소 라이선스와 양립하는지 추가 전에 확인한다. 의존성의 저작권 및 라이선스 고지는 보존한다.
- 단순한 파일 재배치만으로 리팩터링을 완료했다고 보지 않는다. 책임, 의존 방향, 테스트 가능성 중 적어도 하나가 실제로 개선되어야 한다.

### 동작과 호환성

- 기존 제품 기능과 사용자 흐름을 리팩터링과 함께 제거하거나 임의로 축소하지 않는다.
- Codex app-server, OpenCode HTTP API, Kiro ACP의 기존 연결 의미와 provider ID를 유지한다. Codex 대화를 CLI 출력 파싱으로 대체하지 않는다.
- 데스크톱/Android의 WSS pairing, 인증서 지문 확인, SSH 및 Hive relay 연결, relay 암호화, 터미널, workspace 파일 기능을 유지한다.
- 현재 daemon API 및 desktop bridge의 wire shape, CLI 명령, 사용자 설정/저장 데이터는 명시적인 버전 변경과 마이그레이션 계획 없이 깨뜨리지 않는다.
- 대화 이벤트의 순서·중복 방지·완료/진행 상태·승인·중단 동작을 유지한다. 세션을 전환한 뒤 돌아와도 진행 중인 턴 상태를 복구해야 한다.
- 모델, Thinking 수준, provider slash command, skill, mode, 이미지 첨부 등은 실제 provider 지원 범위에 맞춘다.

### 보안과 런타임

- 기존 인증, TLS 지문 고정, E2E relay 암호화, SSH host 확인, 파일 경로 검증 및 작업공간 범위 제한을 약화하지 않는다.
- 토큰, 비밀번호, 개인키, prompt 내용 등 민감 정보를 로그에 추가하지 않는다.
- 지원 중인 Node.js 20 이상, Electrobun desktop, Capacitor Android 실행 환경을 유지한다. 기존 런타임 또는 빌드 도구와 중복되는 프레임워크/의존성을 새로 넣으려면 구체적인 필요성과 유지비용을 설명한다.
- Electron 전환, 별도 서버 제품화, daemon 프로토콜 전면 교체, UI 전면 재설계는 이 리팩터링 목표에 포함되지 않는다.

### 변경 방식

- 한 번에 전체를 다시 쓰지 않는다. adapter 경계 단위로 이동하고 각 변경은 리뷰·되돌리기가 가능한 크기로 유지한다.
- provider 전용 세부사항을 공통 Domain/Application 모델에 누적하지 않는다. 외부 모델을 공통 모델로 바꾸는 작업은 어댑터 경계에서 수행한다.
- 거대한 `any` dispatch를 이름만 바꾼 또 다른 범용 handler로 옮기지 않는다.
- import cycle을 만들지 않는다. Domain은 어떤 상위 계층에도 의존하지 않고, 플랫폼별 main 코드는 공유 UI 안쪽으로 들어오지 않는다.
- UI 동작이나 시각 디자인은 구조를 옮기는 과정에서 임의로 바꾸지 않는다. 화면 개선은 별도 요구사항으로 다룬다.

## 최종 완료 판정

다음 조건을 모두 만족하면 이 아키텍처 리팩터링을 완료로 본다.

- 각 디렉터리의 책임과 의존 방향이 위 원칙에 맞고 순환 의존이 없다.
- Domain/Application 코드가 UI 프레임워크와 네트워크·파일·프로세스 구현에 직접 의존하지 않는다.
- daemon API handler와 React 최상위 컴포넌트가 provider 동작, 전송, 저장 및 화면 세부사항을 모두 조정하는 단일 모듈로 남아 있지 않다.
- 각 provider adapter는 명시된 포트를 구현하고 provider capability에 맞는 결과를 반환한다.
- CLI, 데스크톱, Android가 동일한 애플리케이션 규칙을 사용하며 플랫폼 차이는 adapter에서 처리한다.
- 기존 기능·설정·연결 보안·프로토콜 호환성이 유지되고, root와 제품 문서에서 지원한다고 선언한 각 클라이언트 플랫폼 빌드가 통과한다.
- 임시 호환 계층이 제거되었거나, 제거하지 못한 이유와 유지 범위가 문서화되어 있다.
