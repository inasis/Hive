# Hive 아키텍처 목표와 제한사항

이 문서는 Hive의 계층별 책임, 의존성 방향, 기능·호환성 제한을 정의한다. 현재 구현을 설명하는 변경 일지가 아니라 코드 작성과 리뷰의 기준이다. 진행 상태는 [`refactoring-checkpoint.ko.md`](./refactoring-checkpoint.ko.md)에 간단히 기록한다.

## 목표

Hive의 데스크톱 앱, Android 앱, CLI, 데몬, Codex/OpenCode/Kiro 연동을 각자의 책임에 따라 분리한다. 화면이나 전송 방식이 바뀌어도 세션 규칙이 유지되고, provider를 추가해도 프로토콜 처리와 공통 동작이 한 파일에 모이지 않게 한다.

- UI, CLI, 데몬, SSH, 릴레이, provider 프로토콜 간 의존성이 명시적이다.
- 핵심 모델과 사용자 동작은 React, Node/Bun API, Electrobun, 네트워크, provider SDK에 의존하지 않는다.
- provider가 지원하지 않는 기능을 capability로 정확히 표현한다.
- 데스크톱, Android, CLI, 데몬은 같은 Application 규칙을 사용한다.
- 기능, 저장 데이터, 연결 보안과 기존 클라이언트 호환성을 작은 단위로 유지한다.

## 계층과 의존성 방향

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

Composition roots assemble interfaces, use cases, and adapters per process.
```

1. **Domain**은 제품 용어, provider capability, 세션·대화 모델과 순수 규칙을 소유한다.
2. **Application**은 사용자 동작을 유스케이스로 표현하고 필요한 외부 동작을 포트로 선언한다.
3. **Adapters**는 포트를 구현하며 외부 입력을 검증하고 공통 모델로 변환한다.
4. **Interfaces**는 외부 요청을 검증해 유스케이스를 호출하고 결과를 직렬화한다.
5. **Composition roots**는 실행 환경별 구현을 조립하고 프로세스 수명 주기를 관리한다.
6. 의존성은 바깥에서 안쪽으로 향한다. Domain과 Application은 UI, 네트워크, 파일, 프로세스 구현을 import하지 않는다.

## 구성요소의 책임

### Domain

- 공통 assistant/provider 모델, capability, session, transcript, model, reasoning, skill, command와 mode를 정의한다.
- 모든 provider가 같은 기능을 지원한다고 가정하지 않는다.
- JSON-RPC, ACP, HTTP 응답 객체나 운영체제 세부사항을 모델에 노출하지 않는다.

### Application

- provider 연결, 세션 목록·생성·열기·삭제·fork, prompt·turn·approval, 설정, workspace 파일과 terminal 동작을 유스케이스로 제공한다.
- 각 유스케이스는 필요한 포트만 사용한다. 모든 기능을 가진 manager 하나로 동작을 다시 모으지 않는다.
- streaming event의 순서와 진행 상태가 세션 전환 뒤에도 복구되도록 명시적인 계약을 사용한다.

### Provider adapters

- **Codex**는 app-server 통신, thread/history 처리, turn/event 변환, 모델과 Thinking 지원을 담당한다.
- **OpenCode**는 HTTP API, 서버 수명 주기, session/message/model 변환을 담당한다.
- **Kiro**는 ACP 연결, session/mode/approval/command/skill/model 변환을 담당한다.
- 외부 DTO와 오류를 adapter 안에 두고, 입력은 `unknown`에서 검증한다.
- 지원하지 않는 동작은 명확한 오류로 반환한다. 다른 provider 방식을 흉내 내지 않는다.

### Infrastructure adapters

SSH, Hive TCP relay와 종단 간 암호화, daemon WSS 인증·인증서 지문 확인, PTY, workspace 파일, 로컬 설정 저장처럼 운영체제나 네트워크에 묶인 기능을 구현한다. Application은 이 구현을 포트를 통해서만 사용한다.

### Interfaces와 UI

- daemon API, CLI, desktop bridge는 입력 검증, 유스케이스 호출, 결과 변환만 담당한다.
- IPC/API 타입은 가능한 한 구체적으로 선언하고 공개 경계에서 무검증 cast와 `any`가 전파되지 않게 한다.
- React UI는 렌더링, 사용자 입력, 화면 상태를 맡는다. provider 프로토콜과 원격 연결 수명 주기를 구현하지 않는다.
- 공통 desktop/Android 화면은 공유 UI와 typed platform port를 사용한다. Electrobun 기능은 desktop adapter에 둔다.
- UI feature 간 직접 의존을 피하고 공유 계약은 shared UI 경계에 둔다.

## 현재 구현 상태

1. **Domain과 capability — 구현됨.** 공통 provider catalog가 Codex, OpenCode, Kiro의 capability를 선언하며 일반 세션·대화 흐름은 provider ID 분기 대신 catalog를 사용한다.
2. **Application과 typed contracts — 구현됨.** 세션·대화·turn·settings·terminal·workspace 경계를 포트와 유스케이스로 나눴다. daemon 요청·응답은 method별 DTO와 runtime 검증기를 사용한다.
3. **Provider adapters — 책임별 분리됨.** Codex app-server, OpenCode HTTP API, Kiro ACP 처리를 각 provider 아래에 둔다. provider DTO는 공통 모델 경계 밖으로 전파하지 않는다.
4. **Transport와 composition — 분리됨.** SSH, WSS, relay, files, terminal, persistence adapter를 process별 composition root에서 조립한다.
5. **UI feature — 분리됨.** 연결, 대화, 세션, 설정, 기술 창, workspace 기능을 전용 모듈로 조립한다. `App.tsx`는 renderer composition root 역할을 한다.
6. **이전 내부 경로 — 정리됨.** 소비자를 이동한 뒤 중복 호환 모듈과 re-export를 제거했다. `src/cli.ts` 등 실행 설정이 참조하는 실제 진입점과 이전 클라이언트·저장 데이터 호환성에 필요한 계약은 유지한다.

## 제한사항과 변경 불가 조건

### 구조와 독립 구현

- Paseo의 내부 디렉터리, 데이터 모델, 코드, 고유 UX를 복제하지 않는다. 공개 동작을 참고하더라도 Hive 도메인과 경계에 맞게 독립 설계한다.
- pi/OpenCode/Codex 저장소는 공개 동작과 프로토콜을 조사하는 참고 자료로 사용할 수 있다. 코드를 재사용하거나 구조를 따르기 전 라이선스와 고지 의무를 확인한다.
- Hive의 BSD-2-Clause와 의존성의 저작권·라이선스 고지를 보존한다.
- 파일 재배치만으로 리팩터링을 완료했다고 보지 않는다. 책임, 의존 방향, 검증 가능성 가운데 하나를 실제로 개선한다.

### 동작과 호환성

- 기존 제품 기능과 사용자 흐름을 임의로 제거하거나 축소하지 않는다.
- Codex app-server, OpenCode HTTP API, Kiro ACP의 연결 의미와 provider ID를 유지한다. Codex 대화를 CLI 출력 파싱으로 대체하지 않는다.
- desktop/Android WSS pairing, 인증서 지문 확인, SSH, Hive relay 암호화, terminal, workspace 파일 기능을 유지한다.
- daemon API·desktop bridge wire shape, CLI 명령, 사용자 설정·저장 데이터는 버전 변경과 마이그레이션 계획 없이 깨뜨리지 않는다.
- 대화 event의 순서, 중복 방지, 완료·진행·승인·중단 의미를 유지한다. 세션을 전환한 뒤 진행 중인 turn 상태를 복구한다.
- model, Thinking, provider slash command, skill, mode, image 첨부는 provider 지원 범위에 맞춘다.

### 보안과 런타임

- 인증, TLS 지문 고정, SSH host 검증, relay E2E 암호화, workspace 경로 제한을 약화하지 않는다.
- 토큰, 비밀번호, 개인키, prompt와 파일 내용을 로그나 오류·진단 출력에 추가하지 않는다.
- JSON, 저장값, DOM, 프로세스 출력, IPC/API 입력은 경계에서 검증한다.
- 새 의존성을 추가하기 전에 기존 런타임으로 해결할 수 있는지, 라이선스와 유지 비용이 적절한지 확인한다.
- 지원하는 Node.js 20 이상, Electrobun desktop, Capacitor Android 실행 환경을 유지한다. Electron 전환, 별도 서버 제품화, daemon protocol 전면 교체, UI 전면 재설계는 이 목표에 포함하지 않는다.

### 변경 방식과 검증

- 한 번에 책임 하나를 옮기고 호출자와 포트 구현을 함께 갱신한다. 큰 파일 이동이나 요청과 무관한 정리를 섞지 않는다.
- 범용 `any`, 무분별한 타입 단언, 범용 handler로 책임을 다시 모으는 패턴을 추가하지 않는다.
- 코드 변경에 맞는 기존 build와 동작 확인을 수행한다. 빌드 성공을 runtime 호환성 확인으로 간주하지 않는다.
- 마지막에 `git diff --check`와 diff를 확인한다. 실행하지 않은 검증이나 확인하지 않은 플랫폼 동작을 통과했다고 보고하지 않는다.

## 최종 완료 기준

- 계층 책임과 의존 방향이 위 원칙에 맞고 import cycle이 없다.
- Domain/Application은 UI 프레임워크와 네트워크·파일·프로세스 구현에 직접 의존하지 않는다.
- daemon handler와 React 최상위 컴포넌트가 provider, transport, storage 또는 화면 세부사항을 독점적으로 조정하지 않는다.
- 각 provider adapter는 명시된 포트를 구현하고 capability에 맞는 결과를 반환한다.
- CLI, desktop, Android는 같은 Application 규칙을 사용하며 플랫폼 차이는 adapter에서 처리한다.
- 기존 기능, 설정, 연결 보안, protocol 호환성을 유지하고 지원 대상으로 선언한 client platform의 build가 통과한다.
- 이전 내부 호환 경로가 제거되었거나 유지 이유와 범위가 문서화되어 있다.
