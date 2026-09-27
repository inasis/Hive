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
- **Kiro**: ACP 연결, session/mode/approval/command/skill/model 변환을 담당한다.
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
   - 현재 기준 커밋은 `9582689`, 작업 브랜치는 `refactor/layered-architecture`, 시작 변경은 `7ce5d93`이다.
   - `src/assistant-providers.ts`는 이전 import의 임시 호환 진입점이다.
2. **Application 포트와 typed contract**
   - provider 및 workspace/terminal/event 포트를 정의한다.
   - `daemon-api-handlers.ts`의 `any` 기반 dispatch를 검증된 요청/응답 및 유스케이스 경계로 전환한다.
   - 공개 API에서 provider별 파라미터 차이와 기능 미지원 상태를 타입으로 표현한다.
3. **provider 구현 분리**
   - 중앙 handler의 Codex, OpenCode, Kiro 분기를 각각의 provider adapter/use case로 이동한다.
   - 한 provider씩 이동하고 변환 규칙, 에러 및 이벤트 의미를 보존한다.
4. **전송·시스템 어댑터와 조립**
   - SSH, relay, WSS, PTY, 파일, persistence와 각 실행 프로세스의 조립 코드를 경계에 둔다.
   - 시작/종료와 재연결 동작을 명확히 하고 자원 정리를 한 소유자가 맡는다.
5. **UI의 기능별 분리**
   - 거대한 `App.tsx`를 연결, 세션, 대화 타임라인, composer, 설정, workspace 패널 등의 기능 단위로 나눈다.
   - 브리지 client, 화면 상태, UI 컴포넌트의 책임을 구분한다.
6. **호환 계층 정리**
   - 이전 경로의 re-export와 임시 변환 코드는 모든 소비자가 새 경로로 이동한 뒤 제거한다.
   - 현재 코드와 문서에 남은 레거시 명칭 및 중복 타입을 확인한다.

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
- 기존 기능·설정·연결 보안·프로토콜 호환성이 유지되고, root와 지원 클라이언트 빌드가 통과한다.
- 임시 호환 계층이 제거되었거나, 제거하지 못한 이유와 유지 범위가 문서화되어 있다.
