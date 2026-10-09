# Hive 아키텍처 목표와 제한사항

이 문서는 Hive의 계층별 책임, 의존성 방향, 기능·호환성 제한을 정의한다. 현재 구현을 설명하는 변경 일지가 아니라 코드 작성과 리뷰의 기준이다. 진행 상태는 [`refactoring-checkpoint.ko.md`](./refactoring-checkpoint.ko.md)에 간단히 기록한다.

## 목표

Hive의 데스크톱 앱, Android 앱, CLI, 데몬, Codex/OpenCode/Kiro 연동을 각자의 책임에 따라 분리한다. 화면이나 전송 방식이 바뀌어도 세션 규칙이 유지되고, provider를 추가해도 프로토콜 처리와 공통 동작이 한 파일에 모이지 않게 한다.

- UI, CLI, 데몬 WSS, SSH, provider 프로토콜 간 의존성이 명시적이다.
- 핵심 모델과 사용자 동작은 React, Node/Bun API, Electrobun, 네트워크, provider SDK에 의존하지 않는다.
- provider가 지원하지 않는 기능을 capability로 정확히 표현한다.
- 데스크톱, Android, CLI, 데몬은 같은 Application 규칙을 사용한다.
- 기능, 저장 데이터, 연결 보안과 기존 클라이언트 호환성을 작은 단위로 유지한다.

### 협업 도메인 개발 기준

협업(Collaboration)을 Hive의 핵심 도메인으로 하는 bounded context, Entity·Value Object·Aggregate 구조, Domain Service/Policy, Domain Repository 인터페이스, Application DTO·Use Case·Service 기준, A2A/A2B 정책과 단계별 적용 경로는 [협업 도메인 DDD 개발 기준과 적용 계획](./collaboration-domain-plan.ko.md)에 정리한다. 일반화된 ports-and-adapters/헥사고날 아키텍처는 목표로 삼지 않는다. A2A 재방문 계약과 과거 snapshot 검증 불일치의 해결 내용은 [A2A·A2B 흐름 문서](./a2a-a2b-flows.ko.md)에 기록한다.

## 계층과 의존성 방향

```text
Desktop / Android Presentation ─┐
CLI ──────────────────┼──> Interfaces / typed contracts
Daemon API ───────────┘                 │
                                      ▼
                         Application services / use cases
                                         │
                                         ▼
                  Domain models, aggregates, Repository contracts
                                         ▲
                                         │ implements
                              Infrastructure (`src/infrastructure`)
                              (provider protocols, SSH, WSS,
                               terminal, files, persistence)

Infrastructure composition roots assemble interfaces, Application services/use cases, and concrete implementations per process. Existing provider and platform integrations remain technology-specific modules; this is not a mandate to add a generic port for every dependency.
Desktop and Android share React presentation in `src/presentation`; app-specific presentation stays under `apps/<app>`.
```

1. **Domain**은 bounded context별 제품 용어와 모델, Entity·Value Object·Aggregate, 순수 규칙과 Aggregate 영속성 계약인 Repository 인터페이스를 소유한다. 한 Entity가 소유하기 어려운 실제 업무 결정은 Domain Service/Policy에 둔다. 도메인 모델은 필요한 외부 사실을 Application에서 전달받아 판단하고, 외부 호출과 저장은 수행하지 않는다. 각 컨텍스트가 모델 의미를 일관되게 정의하며 다른 컨텍스트의 모델을 직접 공유하지 않는다. Repository 계약은 도메인 타입만 표현하고 저장 기술에 의존하지 않는다.
2. **Application**은 사용자 동작을 유스케이스로 표현하고, 여러 유스케이스를 조합하는 Application Service를 둘 수 있다. Use Case 입·출력 및 계층 간 전달 데이터는 DTO로 표현한다. Application Service는 DTO를 사용해 흐름과 트랜잭션을 조정하고 도메인 판단과 불변식은 Domain에 위임한다. provider 실행, queue, 시계, 외부 서비스 연동은 기능에 맞는 구체적 모듈로 연결하며 모든 의존성을 위한 범용 포트 계층을 만들지 않는다. Aggregate Repository 계약은 Domain에 둔다.
3. **Infrastructure**는 Domain Repository를 구현하고 provider protocol, network, persistence, terminal, workspace 같은 외부 기능을 연결한다. Provider별 protocol 변환 모듈은 구체적 기술 통합의 일부로 둔다.
4. **Interfaces**는 외부 요청을 검증해 유스케이스를 호출하고 결과를 직렬화한다.
5. **Composition roots**는 Infrastructure의 `composition` 하위 디렉터리에 두고 실행 환경별 구현을 조립한다. 조립 코드는 정책과 제품 기능을 소유하지 않는다.
6. 의존성은 바깥에서 안쪽으로 향한다. Domain과 Application은 UI, 네트워크, 파일, 프로세스 구현을 import하지 않는다.

## 구성요소의 책임

### Domain

- 공통 assistant/provider 모델, capability, session, transcript, model, reasoning, skill, command와 mode를 정의한다.
- 협업 Aggregate의 Repository 인터페이스를 포함해 도메인 모델을 영속화하는 기술 중립 계약을 소유한다.
- 한 Entity가 자연스럽게 소유하지 않는 도메인 결정은 순수 Domain Service/Policy로 표현한다. 여러 도메인 메서드를 순서대로 호출하는 조율 코드만을 이유로 서비스를 만들지 않는다. 외부 사실 조회와 효과는 Application/Infrastructure가 담당하고, Domain Service/Policy는 전달받은 사실로 결정한다.
- 각 bounded context가 자기 용어와 모델의 의미를 소유한다. 컨텍스트 간 데이터는 Application 계약과 명시적 매핑을 통해 전달한다.
- 모든 provider가 같은 기능을 지원한다고 가정하지 않는다.
- JSON-RPC, ACP, HTTP 응답 객체나 운영체제 세부사항을 모델에 노출하지 않는다.

### Application

- provider 연결, 세션 목록·생성·열기·삭제·fork, prompt·turn·approval, 설정, workspace 파일과 terminal 동작을 유스케이스로 제공한다.
- Use Case 입력·출력과 Application Service가 외부 계층에 전달하는 데이터는 DTO로 표현한다. Domain Aggregate/Entity/Value Object는 Application 내부에서 규칙을 호출할 때 사용하고 외부 응답이나 wire DTO로 노출하지 않는다.
- 여러 유스케이스를 조합해야 하는 상위 흐름은 Application Service가 DTO로 Use Case를 호출해 구성한다. 호출 순서와 트랜잭션 경계를 조정하되 정책 판단이나 Aggregate 불변식을 복제하지 않고 Domain 모델에 위임한다.
- Domain Service/Policy가 반환한 결정을 바탕으로 후속 호출을 선택하는 것은 Application의 흐름 조정이다. Aggregate의 불변식은 Application 분기만으로 보호하지 말고 root의 행위에서도 강제한다.
- 각 유스케이스는 Domain Repository를 사용하고 필요한 provider·workspace·runtime 기능은 기존의 구체적 통합 모듈과 연결한다. 모든 의존성을 위한 범용 포트와 어댑터 계층을 만들지 않으며, Aggregate Repository 계약을 중복 선언하지 않는다. 모든 기능을 가진 manager 하나로 동작을 다시 모으지 않는다.
- streaming event의 순서와 진행 상태가 세션 전환 뒤에도 복구되도록 명시적인 계약을 사용한다.

### Provider integrations

- **Codex**는 app-server 통신, thread/history 처리, turn/event 변환, 모델과 Thinking 지원을 담당한다.
- **OpenCode**는 HTTP API, 서버 수명 주기, session/message/model 변환을 담당한다.
- **Kiro**는 ACP 연결, session/mode/approval/command/skill/model 변환을 담당한다.
- provider별 protocol DTO와 오류는 해당 통합 모듈 안에 두고, 입력은 `unknown`에서 검증한다.
- 지원하지 않는 동작은 명확한 오류로 반환한다. 다른 provider 방식을 흉내 내지 않는다.

### Infrastructure integrations

`src/infrastructure` 아래에 Domain Repository 구현과 provider protocol 통합, SSH, daemon WSS 인증·인증서 지문 확인, PTY, workspace 파일, 로컬 설정 저장 구현을 둔다. Desktop renderer의 브라우저·Electrobun·IndexedDB 구현은 `apps/desktop/src/platform`에 둔다. 저장소 인터페이스는 Domain이 소유하며, provider·platform 경계에는 실제 통합에 필요한 구체적 typed API만 둔다.

### 외부 요청 경계와 실행 앱

- 별도의 `src/interfaces` 계층은 두지 않는다. daemon API 요청·응답 계약은 `src/application/dto/daemon`, 검증과 Use Case 연결은 `src/application/services/daemon-api`에서 소유한다.
- CLI 명령 처리와 terminal 출력은 `apps/cli`; mobile daemon RPC server는 `apps/daemon`; desktop/web/Android 실행 코드는 각각 해당 `apps/<runtime>`에 둔다. 공용 React 화면은 `src/presentation`에 둔다.
- 외부 요청·응답 DTO와 Application Use Case DTO는 명시적으로 변환한다. Domain 모델이나 persistence snapshot을 wire DTO로 재사용하지 않고, 공개 경계에서 무검증 cast와 `any`가 전파되지 않게 한다.
- provider·HTTP·WebSocket protocol의 구체 transport와 직렬화 구현은 `src/infrastructure/transport`에 둔다. 앱 실행 코드는 해당 Infrastructure 통합을 사용한다.

### Presentation

- 공용 React Presentation은 `src/presentation`에 두고 렌더링, 사용자 입력, 화면 상태를 맡긴다. 앱 전용 UI 확장은 `apps/<app>/src/presentation`에 둔다. provider 프로토콜과 원격 연결 수명 주기는 Presentation에 구현하지 않는다.
- 같은 Presentation을 desktop과 Android에서 공유하고 typed platform contract를 사용한다. 브라우저·Electrobun·IndexedDB 기능은 desktop platform module에 둔다.
- Presentation feature 간 직접 의존을 피하고 공유 계약은 `presentation/shared` 경계에 둔다.
- `presentation/composition`은 화면 feature와 hook만 조립한다. renderer와 platform module의 의존성 연결은 `apps/desktop/src/platform/composition`에서 담당하고, `main.tsx`는 renderer 진입점으로 UI runtime을 공급한다.

### 소스 계층 배치

```text
src/domain/                         제품 모델, 순수 규칙, Domain Repository 계약
src/domain/<context>/repositories/  Aggregate별 Repository 인터페이스
src/application/{services,use-cases}/ 유스케이스와 조합 서비스
src/application/dto/                유스케이스 DTO와 daemon API 계약 DTO
src/application/services/daemon-api daemon 요청 검증과 Use Case 연결
src/infrastructure/                 외부 구현과 composition roots
  composition/                      프로세스별 구현 조립
  providers/                         provider별 protocol 통합
  persistence/                       Domain Repository와 파일·상태 저장소 구현
  runtime/                           timer 등 runtime 구현
  terminal/                          PTY·terminal 구현
  transport/                         네트워크·daemon transport
  workspace/                         workspace 파일·lock 구현
src/presentation/                    desktop/Android 공용 React Presentation
apps/cli/src/{commands,presentation}/ CLI 인자, 명령 처리, terminal 출력
apps/cli/src/composition/            CLI 실행 조립
apps/daemon/src/{server,composition}/ daemon RPC와 실행 조립
apps/web/src/                        web 실행 앱
apps/android/                        Android 앱과 native integration
apps/desktop/src/presentation/       desktop 전용 Presentation 확장
apps/desktop/src/platform/           renderer Infrastructure adapters
  composition/                       Application과 platform module 조립
```

## 현재 구현 상태

1. **Domain과 capability — 구현됨.** 공통 provider catalog가 Codex, OpenCode, Pi, Kiro의 capability를 선언하며 일반 세션·대화 흐름은 provider ID 분기 대신 catalog를 사용한다.
2. **Application과 typed contracts — 구현됨.** 세션·대화·turn·settings·terminal·workspace 흐름이 책임별 모듈로 나뉘어 있다. daemon 요청·응답은 method별 DTO와 runtime 검증기를 사용한다. 이 기존 분리를 새 범용 port 계층으로 확장하지 않는다.
3. **Infrastructure와 provider integrations — 책임별 분리됨.** Codex app-server, OpenCode HTTP API, Pi RPC, Kiro ACP는 `src/infrastructure/providers`에, transport/persistence/terminal/workspace 구현은 infrastructure의 전용 하위 경로에 둔다. provider DTO는 공통 모델 경계 밖으로 전파하지 않는다.
4. **실행 앱과 composition roots — 분리됨.** `apps/cli`와 `apps/daemon`이 각 진입점 및 전용 실행 코드를 소유한다. 공유 WSS daemon runtime 조립은 `src/infrastructure/composition`에 남고, desktop renderer entry는 공용 Presentation과 platform module을 조립한다. Android 패키지는 공용 renderer를 사용한다.
5. **Presentation — 분리됨.** Desktop/Android 공용 React 화면은 `src/presentation` 아래에서 연결, 대화, 세션, 설정, 창, workspace feature로 나뉜다. 앱 전용 UI 확장은 `apps/<app>/src/presentation`에 둔다. renderer composition root가 공용 feature와 platform module을 조립한다. 트랜스크립트 그룹화는 Domain에, 로컬 트랜스크립트 저장 계약은 Application에 두며 IndexedDB 구현은 platform module에서 조립한다.
6. **이전 내부 경로 — 정리됨.** 기존 `src/interfaces`와 `src/cli.ts`의 책임을 Application DTO/service, Infrastructure transport, `apps/cli`, `apps/daemon`으로 분배했다. CLI의 실제 진입점은 `apps/cli/src/main.ts`이며, 이전 클라이언트·저장 데이터 호환성에 필요한 계약은 유지한다.

## 제한사항과 변경 불가 조건

### 구조와 독립 구현

- Paseo의 내부 디렉터리, 데이터 모델, 코드, 고유 UX를 복제하지 않는다. 공개 동작을 참고하더라도 Hive 도메인과 경계에 맞게 독립 설계한다.
- pi/OpenCode/Codex 저장소는 공개 동작과 프로토콜을 조사하는 참고 자료로 사용할 수 있다. 코드를 재사용하거나 구조를 따르기 전 라이선스와 고지 의무를 확인한다.
- Hive의 BSD-2-Clause와 의존성의 저작권·라이선스 고지를 보존한다.
- 파일 재배치만으로 리팩터링을 완료했다고 보지 않는다. 책임, 의존 방향, 검증 가능성 가운데 하나를 실제로 개선한다.

### 동작과 호환성

- 기존 제품 기능과 사용자 흐름을 임의로 제거하거나 축소하지 않는다.
- Codex app-server, OpenCode HTTP API, Kiro ACP의 연결 의미와 provider ID를 유지한다. Codex 대화를 CLI 출력 파싱으로 대체하지 않는다.
- desktop/Android WSS pairing과 인증서 지문 확인, SSH, terminal, workspace 파일 기능을 유지한다. TCP relay는 제거하며 WSS daemon pairing을 기본 연결 경로로 사용한다.
- daemon API·desktop bridge wire shape, CLI 명령, 사용자 설정·저장 데이터는 버전 변경과 마이그레이션 계획 없이 깨뜨리지 않는다.
- 대화 event의 순서, 중복 방지, 완료·진행·승인·중단 의미를 유지한다. 세션을 전환한 뒤 진행 중인 turn 상태를 복구한다.
- model, Thinking, provider slash command, skill, mode, image 첨부는 provider 지원 범위에 맞춘다.

### 보안과 런타임

- 인증, TLS 지문 고정, SSH host 검증, workspace 경로 제한을 약화하지 않는다. WSS pairing token과 인증서 지문 확인을 적용한다.
- 토큰, 비밀번호, 개인키, prompt와 파일 내용을 로그나 오류·진단 출력에 추가하지 않는다.
- JSON, 저장값, DOM, 프로세스 출력, IPC/API 입력은 경계에서 검증한다.
- 새 의존성을 추가하기 전에 기존 런타임으로 해결할 수 있는지, 라이선스와 유지 비용이 적절한지 확인한다.
- 지원하는 Node.js 20 이상, Electrobun desktop, Capacitor Android 실행 환경을 유지한다. Electron 전환, 별도 서버 제품화, daemon protocol 전면 교체, UI 전면 재설계는 이 목표에 포함하지 않는다.

### 변경 방식과 검증

- 한 번에 책임 하나를 옮기고 호출자와 해당 기능의 구체 통합 모듈을 함께 갱신한다. 큰 파일 이동이나 요청과 무관한 정리를 섞지 않는다.
- 범용 `any`, 무분별한 타입 단언, 범용 handler로 책임을 다시 모으는 패턴을 추가하지 않는다.
- 코드 변경에 맞는 기존 build와 동작 확인을 수행한다. 빌드 성공을 runtime 호환성 확인으로 간주하지 않는다.
- 마지막에 `git diff --check`와 diff를 확인한다. 실행하지 않은 검증이나 확인하지 않은 플랫폼 동작을 통과했다고 보고하지 않는다.

## 최종 완료 기준

- 계층 책임과 의존 방향이 위 원칙에 맞고 import cycle이 없다.
- Domain/Application은 UI 프레임워크와 네트워크·파일·프로세스 구현에 직접 의존하지 않는다.
- daemon handler와 React 최상위 컴포넌트가 provider, transport, storage 또는 화면 세부사항을 독점적으로 조정하지 않는다.
- 각 provider 통합은 protocol 변환과 capability에 맞는 결과 반환을 담당한다.
- CLI, desktop, Android는 같은 Application 규칙을 사용하며 플랫폼 차이는 해당 플랫폼 module에서 처리한다.
- 기존 기능, 설정, 연결 보안, protocol 호환성을 유지하고 지원 대상으로 선언한 client platform의 build가 통과한다.
- 이전 내부 호환 경로가 제거되었거나 유지 이유와 범위가 문서화되어 있다.
