# 아키텍처 리팩터링 체크포인트

이 문서는 재개에 필요한 현재 상태와 미검증 범위만 기록한다. 설계 원칙과 완료 기준은 [`refactoring-goals.ko.md`](./refactoring-goals.ko.md), A2A 기능 설명과 상세 한계는 [`a2a-runtime.ko.md`](./a2a-runtime.ko.md)를 따른다.

## 현재 상태 — 2026-09-29

- 계층형 구조가 적용되어 있다. Domain과 Application은 제품 규칙·포트를 소유하고, provider/transport/persistence 구현은 adapters에 둔다. Interfaces는 요청 경계, composition roots는 프로세스별 조립을 맡는다.
- Desktop UI는 연결, 대화, 세션, 설정, workspace와 창 기능으로 나뉘며 `App.tsx`가 조립한다. 공유 계약은 `ui/shared`에 있고 feature 간 직접 import는 두지 않는다.
- Codex, OpenCode, Kiro provider와 SSH, WSS, TCP relay, workspace file, terminal adapter를 분리했다. daemon API와 desktop/mobile bridge의 기존 wire shape, CLI 입력 의미, 사용자 저장 형식을 유지한다.
- npm workspaces는 루트 `package-lock.json` 하나로 desktop과 Android 의존성을 관리한다. 루트 명령이 공유 UI를 빌드한 뒤 Android workspace를 빌드한다. package별 설치 경로와 lockfile은 남아 있지 않다.
- A2A runtime과 별도 HTTP/SSE 및 MCP 경로가 추가됐다. 비동기 task/callback 진행 상태와 남은 provider runtime 확인은 A2A 문서를 참조한다.

## 이번 정리에서 확인한 검증

- 통과: `npm run build`, `npm run build:app`, `npm run desktop:build`, `npm ci --dry-run --ignore-scripts`, workspace `npm ls`, `git diff --check`.
- `npm run android:build`는 desktop web build와 Capacitor sync까지 진행했다. Gradle이 Java 25 class version 69를 지원하지 않아 Android build는 중단됐다. 현재 환경에는 CI와 문서에서 사용하는 Java 21이 설치되어 있지 않다.
- `src`와 desktop source import graph 검사에서 정식 진입점 외의 고아 TypeScript 모듈은 확인되지 않았다. 등록되지 않고 중복 기능을 제공하던 A2A stdio 진입점은 제거했다.
- A2A 성능 회귀 테스트 `node tests/a2a-performance.test.mjs` 6개 검사가 통과했다. Codex task thread는 ephemeral 시작을 요청하고 응답을 확인해 지속 writer lock 세션으로 대체되지 않게 한다. 등록 thread focus를 유지해 복구용 재오픈 왕복도 생략한다. 임시 provider thread 동작은 mock 기반이며 실제 Codex/OpenCode/Kiro 연결 검증은 아니다.

## 남은 확인

- Android Gradle build를 Java 21 환경에서 다시 실행한다.
- A2A 비동기 provider callback round-trip과 실제 Android 기기의 pairing/reconnect를 별도로 검증한다. 상세 내용과 OpenCode 모델 응답성 제한은 A2A runtime 문서에 기록되어 있다.
- Desktop 화면 상호작용과 Windows runner 산출물은 이 작업에서 직접 확인하지 않았다.
- Android 앱 복귀·재연결은 사용자가 이전 세션에서 기기 확인을 보고했다. 이 세션에서 실기기로 반복하지 않았다.

## 재개 절차

1. 이 문서와 목표 문서를 읽고 현재 검증 범위를 복원한다.
2. 브랜치, HEAD, `git status`, 대상 파일의 diff를 확인하고 기존 변경을 보존한다.
3. 상태가 문서보다 최신이면 실제 코드와 실행 결과를 기준으로 문서를 갱신한다.
4. 코드 변경 후 관련 build와 runtime 확인을 기록한다. build 성공만으로 동작 호환성을 선언하지 않는다.
