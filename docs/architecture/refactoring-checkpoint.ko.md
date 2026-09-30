# 아키텍처 리팩터링 체크포인트

이 문서는 재개에 필요한 현재 상태와 미검증 범위만 기록한다. 설계 원칙과 완료 기준은 [`refactoring-goals.ko.md`](./refactoring-goals.ko.md), A2A 런타임 상세는 [`a2a-runtime.ko.md`](./a2a-runtime.ko.md), A2A/A2B 흐름도와 개발 방향은 [`a2a-a2b-flows.ko.md`](./a2a-a2b-flows.ko.md)를 따른다.

## 현재 상태 — 2026-10-01

- 계층형 구조가 적용되어 있다. Domain과 Application은 제품 규칙·포트를 소유하고, provider/transport/persistence 구현은 adapters에 둔다. Interfaces는 요청 경계, composition roots는 프로세스별 조립을 맡는다.
- Desktop UI는 연결, 대화, 세션, 설정, workspace와 창 기능으로 나뉘며 `App.tsx`가 조립한다. 공유 계약은 `ui/shared`에 있고 feature 간 직접 import는 두지 않는다.
- Codex, OpenCode, Kiro provider와 SSH, WSS, TCP relay, workspace file, terminal adapter를 분리했다. daemon API와 desktop/mobile bridge의 기존 wire shape, CLI 입력 의미, 사용자 저장 형식을 유지한다.
- npm workspaces는 루트 `package-lock.json` 하나로 desktop과 Android 의존성을 관리한다. 루트 명령이 공유 UI를 빌드한 뒤 Android workspace를 빌드한다. package별 설치 경로와 lockfile은 남아 있지 않다.
- A2A runtime과 별도 HTTP/SSE 및 MCP 경로가 추가됐다. 비동기 task/callback 진행 상태와 남은 provider runtime 확인은 A2A 문서를 참조한다.
- 2026-09-30: A2A/A2B send는 접수만 확인하고 발신 에이전트가 계속 실행한다. A2B는 등록된 단일 대상에 결합하고 런타임에서 추가 위임을 거부한다. 완료 콜백은 원래 에이전트의 새 task로 전달한다. 상세 계약은 A2A 문서를 참조한다.

## 이전 기준선 검증 — 2026-09-29

- 통과: `npm run build`, `npm run build:app`, `npm run desktop:build`, `npm ci --dry-run --ignore-scripts`, workspace `npm ls`, `git diff --check`.
- `npm run android:build`는 desktop web build와 Capacitor sync까지 진행했다. Gradle이 Java 25 class version 69를 지원하지 않아 Android build는 중단됐다. 현재 환경에는 CI와 문서에서 사용하는 Java 21이 설치되어 있지 않다.
- `src`와 desktop source import graph 검사에서 정식 진입점 외의 고아 TypeScript 모듈은 확인되지 않았다. 등록되지 않고 중복 기능을 제공하던 A2A stdio 진입점은 제거했다.
- A2A 성능 회귀 테스트 `node tests/a2a-performance.test.mjs` 6개 검사가 통과했다. Codex task thread는 ephemeral 시작을 요청하고 응답을 확인해 지속 writer lock 세션으로 대체되지 않게 한다. 등록 thread focus를 유지해 복구용 재오픈 왕복도 생략한다. 임시 provider thread 동작은 mock 기반이며 실제 Codex/OpenCode/Kiro 연결 검증은 아니다.

## 이번 A2A/A2B 변경 검증

- 2026-10-01 재검증 통과: `npm run build`, `node --test --test-timeout=15000 tests/*.test.mjs` (35 checks), `npm run build:app`, `npm run desktop:build`, `env JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 npm run android:build`, `git diff --check`. Android 명령도 `npm run build:app`을 실행한다.
- 새 mock runtime 검증은 접수 후 provider가 계속 실행 중인 A2A/A2B, 활성 caller 권한 상속, 응답 미전달 시 A2A 요청 실패, MCP와 내부 adapter port 양쪽의 `responseForTaskId` 전달, 기존·신규 agent 수신과 추가 전달/callback/종료 선택, 발신자 비대기, callback 1회 반환 및 재 callback 차단, cross-room/stale callback 거부, offline 대상 callback 실패 가시성, sender 종료 후 같은 workspace child 실행, workspace 대기 중 task 취소·timeout, Codex 활성 writer를 resume하지 않는 metadata 조회, callback task의 독립 실행과 중복 callback 경합, A2B exact target·bonded prompt·MCP/internal 분기 차단, Codex/OpenCode/Kiro provider prompt와 OpenCode 권한·Kiro MCP 구성, 100개 다른 agent가 있는 room에서도 adapter 실행 context에 요청자와 수신자만 전달되는지, 응답 전송 기능이 없는 대상의 조기 제외, CLI JSON 위임의 response ID와 A2A/A2B별 지침을 확인했다.
- 토큰 절감은 이전 대화·room roster를 task prompt와 adapter 실행 context에서 제외하고 접수 응답에서 task/request 본문을 생략하는 회귀 검증으로 확인했다. synthetic fixture에 history 100개와 agent 100개를 넣어도 task prompt는 1,000 UTF-8 byte 미만이며, 약 2.6 KB 요청의 접수 응답은 256 byte 미만이다. provider-reported token usage와 최적화 전후의 동일 조건 실시간 latency 비교는 수집하지 않았다.
- Desktop 빌드에는 GTK deprecated API와 500 kB를 넘는 Vite chunk 경고가 있었다. Android 빌드는 Gradle `flatDir`과 같은 Vite chunk 경고를 냈지만 완료됐다. UI·기기 동작은 확인하지 않았다.
- 실행 중인 Codex CLI 0.159.2/Hive daemon에서 A2A와 A2B live smoke를 각각 통과했다. 발신 task가 응답 task보다 먼저 종료했고, 결과 sentinel이 일치했다. A2B task metadata에서 `a2b-bonded-request`를 확인했다. 요청에는 파일을 읽거나 바꾸지 말라고 지시했다. 실행 후 Codex agent 12개가 모두 `IDLE`이었다.
- callback live smoke에서는 Codex 응답자가 callback을 시도했으나 daemon이 `Delegation would revisit an agent`로 거부했고 별도 callback task는 생기지 않았다. 현재 소스는 callback을 독립 root task로 예약하며, 같은 root에서의 callback mock 테스트는 통과한다.
- 2026-10-01 현재 소스의 격리 runtime에서 최초 발견한 문제는 Codex `thread/resume`의 `thread already has an active writer` 오류였다. 같은 등록 thread의 `thread/read`와 `includeTurns:false`는 성공했다. A2A 최소 세션 확인을 metadata 전용 read로 바꾼 뒤, 격리 runtime에서 A2A 발신자가 먼저 종료하고 응답자가 `responseForTaskId`로 기존 agent에 결과 전달한 뒤 양쪽 task가 독립적으로 완료되는 것을 확인했다. 그 수신자는 callback을 선택했으며 당시에는 추가 callback task를 수동 취소했다. callback 재전송 방지 guard/prompt 반영 후 별도 run에서 원 요청자 callback task가 완료되고, 격리 Codex agent 5개가 모두 `IDLE`로 돌아왔다. 격리 listener는 종료했고 기존 daemon은 유지했다.
- 2026-10-01 현재 활성 daemon을 read-only `tools/list`로 재확인했다. 도구 3개는 있고 wait tool은 없지만 `a2a_send` schema에 `responseForTaskId`가 없으며 description도 generic asynchronous request용이다. 최신 결과 수신자 prompt도 로드되지 않은 구버전이며, daemon 재시작 승인을 아직 받지 않아 실행 상태를 유지했다.
- OpenCode 2.0.16과 Kiro CLI 2.24.1은 실행 환경에 있으나 현재 room에는 해당 provider의 등록 agent가 없어서 live task를 만들지 않았다. 과거 OpenCode model slot 무응답 기록과 나머지 미검증 범위는 A2A runtime 문서를 참조한다.

## 남은 확인

- 최신 callback 구현과 응답 수신자 지침을 활성 Hive daemon에서 확인하려면 기존 daemon 재시작이 필요하다. OpenCode/Kiro는 등록된 대상 세션이 준비되면 live A2A/A2B round-trip을 확인한다. OpenCode 모델 응답성 제한은 A2A runtime 문서에 기록되어 있다.
- Desktop 화면 상호작용과 Windows runner 산출물은 이 작업에서 직접 확인하지 않았다.
- Android 앱 복귀·재연결은 사용자가 이전 세션에서 기기 확인을 보고했다. 이 세션에서 실기기로 반복하지 않았다.

## 재개 절차

1. 이 문서와 목표 문서를 읽고 현재 검증 범위를 복원한다.
2. 브랜치, HEAD, `git status`, 대상 파일의 diff를 확인하고 기존 변경을 보존한다.
3. 상태가 문서보다 최신이면 실제 코드와 실행 결과를 기준으로 문서를 갱신한다.
4. 코드 변경 후 관련 build와 runtime 확인을 기록한다. build 성공만으로 동작 호환성을 선언하지 않는다.
