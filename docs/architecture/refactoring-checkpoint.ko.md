# 아키텍처 리팩터링 세션 재개 체크포인트

이 문서는 작업 세션이 중단되거나 goal이 paused/stalled 상태가 된 뒤에도 같은 리팩터링 목표를 이어가기 위한 진행 메모다. 아키텍처 요구사항의 기준은 항상 [`refactoring-goals.ko.md`](./refactoring-goals.ko.md)이며, 이 체크포인트는 그 범위를 줄이거나 대체하지 않는다.

## 재개 방법

새 세션에서 다음 순서로 이어간다.

1. 이 문서와 [`refactoring-goals.ko.md`](./refactoring-goals.ko.md)를 읽어 전체 목적, 완료 기준, 남은 검증을 복원한다.
2. 저장소에서 현재 브랜치, HEAD, `git status`를 확인한다. 아래 스냅샷은 마지막 기록일 뿐이므로 실제 작업 트리가 더 최신이면 실제 상태를 따른다.
3. 기존 변경을 보존한다. 현재 진행 중인 리팩터링에는 커밋되지 않은 변경이 포함되어 있으므로 상태를 확인하지 않은 `reset`, `checkout`, `clean`, stash 적용/제거를 하지 않는다.
4. goal이 paused/stalled였더라도 완료나 폐기로 해석하지 않는다. 같은 목표와 남은 범위를 유지하고, 중단 지점의 코드 상태를 확인한 뒤 다음 항목부터 진행한다.
5. 코드 변경 뒤 목표 문서의 진행 기록을 갱신하고, 해당 단계의 빌드 및 필요한 동작 회귀 확인을 기록한다. 빌드 성공만으로 런타임 호환성이나 전체 goal 완료를 선언하지 않는다.

## 마지막 확인 스냅샷

- 기록일: 2026-09-28 (Asia/Seoul)
- 브랜치: `refactor/layered-architecture`
- 마지막 확인 HEAD: `94cf241` (`refactor: isolate provider composer commands`). 이전 두 작업 커밋은 `ed15ee6` (`refactor: extract Hive composer commands`), `9a64141` (`refactor: extract daemon rpc and cli helpers`)다.
- 작업 트리: 코드 변경은 위 HEAD에 포함됐고, 현재 `git status --short`에는 architecture goal/checkpoint 문서의 미커밋 수정만 남아 있다. 삭제된 기존 최상위 구현 파일과 새 `src/adapters`, `src/application`, `src/composition`, `src/interfaces`, desktop feature/platform 모듈을 유지한다.
- 최근 구조 변경: Kiro ACP session mapping을 event, notification, catalog, command, image-validation 경계로 분리했다. Kiro ACP server request는 approval dispatcher, workspace file 처리, local/SSH PTY lifecycle로 나눴다. Codex JSON-RPC framing/pending request lifecycle과 app-server local/SSH/encrypted relay 연결을 각각 `codex-rpc.ts`, `codex-process-transport.ts`로 나눴다. Relay E2E peer authentication/key exchange는 `relay-e2e-handshake.ts`, AES-GCM records는 `relay-record-stream.ts`로 분리했다. Android daemon RPC request ID, timeout, reply matching, disconnect cleanup은 `apps/desktop/src/platform/mobile-daemon-rpc.ts`가 맡고, 실제 브라우저 WebSocket/Capacitor 연결 및 listener 수명 주기는 `mobile-daemon-socket.ts`, 인증과 reconnect policy는 `mobile-daemon-transport.ts`가 맡는다.
- 이번 변경: composer 제출·Hive/provider command 라우팅은 `useComposerSubmission`, 실행 중 turn의 steer·중지는 `useConversationTurnControls`, approval 응답은 `useApprovalResponse`로 나눴다. Hive 전용 `/help`, `/quit`, `/side`, `/resume`, `/skills`는 `hive-composer-commands.ts`, provider command catalog 조회·실행은 `provider-composer-commands.ts`로 옮겼다. 응답의 영구 fork는 `useResponseFork`, side-chat 생성과 첫 prompt는 `useSideChatCreation`, 열린 대화 탭 탐색은 `useChatTabNavigation`으로 나눴다. `useSessionWorkflows`에서 thread 열기는 `useThreadOpening`, 폴더 선택·새 세션 dialog·provider 세션 생성은 `useSessionCreation`으로 나눴다. GTK titlebar와 native frame resize는 `useWindowControls`·`useWindowResize`로 분리했다. Desktop Bun의 RPC pending lifecycle은 `daemon-rpc.ts`로 옮기고 `daemon-client.ts`에는 WSS/TLS/auth/reconnect lifecycle을 남겼다. CLI에서는 `runner.ts`가 명령 라우팅, `arguments.ts`가 파싱·검증, `output.ts`가 help·목록 포맷을 맡는다. 기존 UI 명령 순서, CLI 인자·출력, RPC payload, 120초 timeout, turn·승인·fork/session hydration과 탭 흐름은 유지했다.
- 이번 import graph audit: `src`와 `apps/desktop/src`의 208개 TypeScript 소스, 386개 runtime local import/export edge, 784개 전체 static local import/export edge. 순환 0건, 조사한 계층 위반 0건, Domain/Application 외부 패키지 import 0건. 해결되지 않은 상대 경로는 desktop `main.tsx`의 CSS asset import 1건이다.
- CLI와 composer 분리 후 확인: `npm run build` 및 `npm run build:app` 통과. TypeScript AST 계층 검사에서 208개 소스 기준 확인한 Domain/Application 외부 의존 및 Interfaces/UI 상위 계층 의존 위반은 0건이다. Desktop web build는 981.97 kB renderer chunk 경고를 냈으며 통과했다. UI 실제 조작 흐름과 Hive/provider slash command 런타임은 별도 검증하지 않았다.
- Relay E2E 런타임 확인: 임시 ephemeral TCP relay에서 client/agent token 검증·key exchange와 codex/files/terminal 세 채널의 양방향 record stream(180,321 및 131,117 byte payload)을 확인했다. 잘못된 token은 양쪽에서 거부됐고, 변조 record는 AES-GCM 인증 실패로, 닫힌 중간 record는 truncation 오류로 정리됐다. 이 확인은 relay stream adapter의 protocol compatibility만 다루며 UI/provider 기능 전체를 검증하지 않는다.
- Provider transport 런타임 재확인: Codex app-server initialize/thread-list/clean shutdown을 local target, localhost SSH, 임시 TCP relay 및 실제 relay host agent 경로로 확인했다. Kiro는 임시 workspace에서 세션을 만든 뒤 ACP 프로세스를 종료하고, 저장된 세션을 다시 열어 삭제했다. Kiro 테스트 세션을 지우고 임시 workspace를 제거했다.
- 마지막 전체 빌드: `npm run build`, `npm run build:app`, `npm run desktop:build`, `npm run android:build`, `git diff --check`가 relay E2E 분리 뒤 통과했다. Android debug APK는 `artifacts/android/Hive-android-debug.apk`, Linux desktop 결과는 `apps/desktop/build/stable-linux-x64`에 생성됐다. 번들 크기, GTK deprecated API, Gradle restricted API/flatDir 및 npm install script 경고가 남았다. 빌드는 relay 재연결 및 실제 화면 동작을 검증하지 않는다.
- 최근 UI·Bun transport 분리 후 `npm run build`, `npm run build:app`, `npm run desktop:build`, `npm run android:build`와 `git diff --check`가 통과했다. Linux desktop 결과는 `apps/desktop/build/stable-linux-x64`, Android debug APK는 `artifacts/android/Hive-android-debug.apk`에 생성됐다. renderer 500 kB 초과 chunk, GTK deprecated API, Gradle restricted API/flatDir, npm install script 경고가 계속 출력됐다. Bun RPC 분리 이후 desktop WSS 인증·response·reconnect runtime은 확인하지 않았다. 제품 README와 uncommitted GitHub Actions workflow에는 Windows x64 desktop build도 추가돼 있지만, Windows runner 실행 결과는 아직 확인하지 않았다. session create/open, fork/side-chat/tab, native window resize 상호작용도 브라우저·기기 runtime으로 확인하지 않았다.

## Hive 세션 goal 재개 기능

리팩터링 goal을 새 작업 세션에서 이어가는 절차와 Hive 안에서 Codex 대화 goal을 재개하는 기능은 별개다. Hive는 Codex app-server의 Goal API가 있을 때 기존 Codex thread를 연 다음 `/goal resume`을 실행해 goal 상태를 `active`로 바꾼다. 새 turn은 자동 시작하지 않으므로 다음 prompt를 보내야 한다. Kiro와 OpenCode에는 현재 같은 기능이 없다. 사용법은 [`docs/codex-bridge.md`](../codex-bridge.md)에 기록했다.

## 다음 진행 항목

1. 실제 desktop·Android 화면 흐름 및 mobile WSS의 TLS pin/token pairing, disconnect/reconnect는 화면/기기 런타임 게이트로 유지한다. 빌드와 Node transport smoke로 확인했다고 기록하지 않는다.
2. Codex local/SSH/relay와 Kiro ACP 재연결 경로의 전체 작업 동작 외에 OpenCode runtime, wire/storage 호환성의 변경 후 회귀를 계속 대조한다.
3. `refactoring-goals.ko.md`의 모든 단계와 최종 완료 조건을 다시 대조한다. 실제 기능·보안·클라이언트 흐름 검증이 남으면 goal은 계속 진행 상태로 둔다.
4. README에 추가된 Windows x64 target은 Linux build로 검증됐다고 간주하지 않는다. Windows runner의 Electrobun package와 업로드 artifact 생성 결과를 확인한다.
5. Desktop Bun daemon WSS의 certificate pin/token 인증, response schema, timeout/disconnect cleanup 및 reconnect를 새 `BunDaemonRpcChannel` 분리 뒤 runtime으로 확인한다.

## 체크포인트 갱신 규칙

작업을 멈추기 전에는 이 문서의 스냅샷과 다음 항목을 현재 저장소 증거에 맞게 갱신한다. 완료·미완료·미검증을 구분하고, 작업 트리와 빌드 결과를 혼동하지 않는다. 멈춘 세션의 대화 기록만으로 진행 지점을 추측하지 않는다.
