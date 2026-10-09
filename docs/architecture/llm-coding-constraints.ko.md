# LLM 코드 작성 제한사항

이 문서는 Hive 저장소에서 코드를 작성하거나 수정하는 LLM 에이전트의 필수 기준이다. 구체적인 사용자 요청은 이 문서보다 우선한다. 프로젝트의 계층별 목표와 최종 완료 기준은 [`refactoring-goals.ko.md`](./refactoring-goals.ko.md)를 따른다.

## 작업 시작 전

- 저장소 루트와 수정 대상 경로에 적용되는 `AGENTS.md`를 읽는다. 아키텍처 변경 전에는 목표 문서와 최신 진행 기록인 [`refactoring-checkpoint.ko.md`](./refactoring-checkpoint.ko.md)를 확인하고, 협업 도메인을 변경할 때는 [`collaboration-domain-plan.ko.md`](./collaboration-domain-plan.ko.md)의 DDD 기준과 적용 상태도 따른다.
- `git status`와 관련 파일의 diff를 확인해 기존 작업과 이번 요청의 범위를 구분한다. 사용자가 만든 변경을 보존하고, 승인 없이 되돌리거나 덮어쓰지 않는다.
- 현재 호출 경로, 구체 통합 구현, wire 계약, 저장 데이터 소비자를 찾아 수정 범위를 정한다. 파일 위치만 바꾸는 대규모 이동이나 요청과 무관한 정리는 끼워 넣지 않는다.

## 계층과 의존성

- **Domain**에는 bounded context별 Entity, Value Object, Aggregate, 순수 도메인 규칙과 Aggregate 영속성 계약인 Repository 인터페이스를 둔다. 한 Entity가 자연스럽게 소유하지 않는 실제 업무 결정은 Domain Service/Policy에 둔다. 단순한 도메인 메서드 호출 순서만으로 서비스를 추출하지 않는다. 외부 사실은 Application이 조회해 Domain에 전달하고, Domain Service/Policy는 저장·네트워크·provider 호출을 하지 않는다. 각 컨텍스트가 용어와 모델의 의미를 소유하며, 다른 컨텍스트의 Entity/Value Object를 직접 공유하지 않는다. Repository는 도메인 모델만 표현하며 특정 저장 기술을 import하지 않는다. Domain은 React, Node/Bun API, Electrobun, provider SDK, 네트워크, 파일시스템, 프로세스 및 플랫폼 구현을 import하지 않는다.
- **Application**은 유스케이스와 여러 유스케이스를 조합하는 Application Service를 소유한다. Use Case 입·출력과 계층 간 전달 데이터는 DTO로 표현하고, Application Service는 DTO를 사용해 호출 순서와 트랜잭션을 조정하되 도메인 규칙을 소유하지 않는다. 도메인 판단과 불변식은 Aggregate, Value Object, Domain Service/Policy에 위임한다. Application이 도메인 결정 결과로 후속 호출을 고르는 것은 흐름 조정이며, Aggregate root도 자체 불변식을 강제해야 한다. Domain Repository는 DTO가 아닌 Aggregate를 반환한다. Aggregate Repository 인터페이스는 Domain 소유다. 헥사고날 아키텍처를 목표로 삼지 않으며 모든 외부 의존을 범용 포트/어댑터 계층으로 감싸지 않는다.
- **Infrastructure**(`src/infrastructure`)는 Domain Repository를 구현하고 외부 입력을 검증해 공통 모델로 변환한다. provider protocol 통합, transport, persistence, terminal, workspace 구현을 이 계층에 둔다. provider protocol 변환 모듈은 기술별 통합 구현이다. Codex/OpenCode/Kiro의 protocol DTO와 오류를 Domain이나 Presentation으로 유출하지 않는다.
- 별도 **Interfaces 계층은 두지 않는다.** daemon API 계약과 요청 DTO는 `src/application/dto/daemon`, 요청 검증·Use Case 조정은 `src/application/services/daemon-api`에 둔다. CLI 인자·터미널 표현과 daemon 실행 진입 코드는 각각 `apps/cli`, `apps/daemon`의 책임 경로에 둔다. 네트워크 protocol과 직렬화 구현은 `src/infrastructure/transport`에 둔다.
- **Composition roots**는 공유 실행 조립을 `src/infrastructure/composition`, 앱별 실행 조립을 `apps/<runtime>/src/composition`에 둔다. Application Service와 구체 통합 구현을 연결하며, 공통 정책이나 기능을 여기에 쌓지 않는다.
- **Presentation**(`src/presentation`)은 렌더링, 사용자 입력, 공용 화면 상태를 담당하며 Desktop과 Android가 함께 사용하는 UI를 소유한다. 앱별 UI 확장은 `apps/<app>/src/presentation`에 둔다. provider별 HTTP/ACP 처리, daemon RPC 형식, 연결·재연결 수명 주기는 Presentation에 구현하지 않는다. 공용 화면 계약과 모델은 central `src/presentation/shared`에 둔다.
- 컨텍스트 간 데이터는 명시적 Application 계약으로 전달하고, 수신 컨텍스트의 모델로 경계에서 변환한다. 다른 컨텍스트의 Entity, Value Object, Repository 또는 저장 snapshot을 내부 참조로 사용하지 않는다.
- **CLI, daemon, web, desktop, Android** 실행 코드는 `apps/<runtime>`에서 찾을 수 있게 둔다. 모두 같은 Application 규칙과 daemon API DTO를 사용하며, 플랫폼별 동작은 해당 앱의 구체 통합과 bridge를 통한다.
- 의존성은 바깥에서 안쪽으로 향한다. 순환 import를 만들지 않고 Infrastructure나 플랫폼 코드를 Domain/Application/Presentation shared 계약에 역으로 끌어오지 않는다.

## Provider와 capability

- 모든 provider가 같은 기능을 지원한다고 가정하지 않는다. 지원 차이는 Domain capability와 typed catalog로 표현하고, 유스케이스가 provider integration 호출 전에 검증한다.
- provider ID 문자열에 따른 분기를 일반 세션·대화 흐름에 추가하지 않는다. 연결별 설명처럼 provider 차이가 필요한 화면에만 표시 책임을 한정한다.
- 새 기능은 UI 버튼만 추가해 끝내지 않는다. 해당 capability, Application Use Case/Service, typed daemon contract, provider integration, UI 노출 조건을 함께 확인한다.
- provider가 지원하지 않는 동작을 다른 provider 방식으로 흉내 내지 않는다. 명확한 미지원 결과나 오류를 반환한다.
- 외부 protocol 응답은 `unknown`에서 시작해 provider integration 경계에서 검증한다. 검증되지 않은 provider 객체를 공통 타입으로 단언하지 않는다.

## API, 저장 데이터와 동작 호환성

- daemon API와 desktop/mobile bridge의 method 이름, 필드, 응답 shape, 요청 ID 상관관계, 이벤트 순서와 중복 처리 의미를 보존한다. wire 변경이 꼭 필요하면 모든 소비자를 추적하고 호환 전략과 마이그레이션을 함께 명시한다.
- 설정, provider 메타데이터, side-chat 및 세션 저장값은 기존 데이터가 새 코드에서 복원되는지 확인한다. 새 필드는 안전한 기본값을 정하고, 잘못된 데이터는 경계에서 거부하거나 명시적으로 무시한다.
- prompt 전송, 세션 생성·열기·삭제, 승인, steer·중단, 재연결 뒤 turn 복구의 기존 사용자 동작을 임의로 축소하거나 재정의하지 않는다.
- 기존 CLI 명령과 인자 의미, 데스크톱/Android 공용 화면 동작을 유지한다. 동작이나 시각 디자인 변경은 요청이 있을 때만 포함한다.

## 보안과 런타임

- 인증, TLS 인증서 지문 고정, SSH host 검증, WSS pairing token 검증, workspace 경로 제한을 약화하지 않는다. 우회·재시도 로직이 보안 실패를 성공으로 취급하지 않게 한다.
- 토큰, 비밀번호, 개인키, 인증서 비밀값, 사용자 prompt와 파일 내용을 로그·오류·진단 출력에 추가하지 않는다.
- JSON, 저장값, DOM, 프로세스 출력, IPC/API 입력은 신뢰하지 않는다. 구체적인 schema와 경계 검증을 사용한다.
- 새 의존성을 추가하기 전에 기존 런타임으로 해결할 수 있는지와 라이선스·유지 비용을 확인한다. Hive의 BSD-2-Clause 및 재사용 코드의 고지 의무를 보존한다.
- 다른 프로젝트의 내부 코드나 구조를 복사하지 않는다. 공개 동작이나 프로토콜을 참고할 때에도 라이선스와 출처 의무를 확인하고 Hive 도메인에 맞게 독립 구현한다.

## 코드 변경 방식과 검증

- 한 번에 책임 하나를 옮기고, 호출자와 해당 기능의 구체 통합 구현을 함께 갱신한다. 변경이 파일 이동에 그치지 않고 책임·의존 방향·검증 가능성 중 실제 개선을 만드는지 확인한다.
- 새 forwarding facade, re-export만 하는 모듈, 중복 위임 wrapper를 만들지 않는다. 분리한 모듈이 구체적인 동작이나 상태를 소유하게 하고, 소비자가 그 동작 모듈을 직접 참조하도록 갱신한다.
- 범용 `any`, 광범위한 타입 단언, 범용 handler 하나로 책임을 다시 모으는 패턴을 추가하지 않는다. 구체적인 DTO, 판별 유니온, capability 조건을 우선한다.
- 변경에 맞는 기존 검증 명령을 실행한다. 루트 TypeScript, desktop web/native, Android는 각각 `npm run build`, `npm run build:app`, `npm run desktop:build`, `npm run android:build`를 사용한다. 사용자 지시나 실행 환경에 따라 제외한 플랫폼은 이유와 미검증 상태를 기록한다.
- 동작 변경은 관련 provider·transport 경로를 실제로 검증하고, 검증 환경이 없으면 한계를 기록한다. 빌드 성공을 런타임 동작 확인으로 간주하지 않는다.
- 마지막에 `git diff --check`와 diff를 확인한다. 보고에는 변경 파일, 실행한 검증의 실제 결과, 경고 및 미검증 범위를 구분해 쓴다. 실행하지 않은 명령이나 확인하지 않은 화면·기기·플랫폼을 통과했다고 말하지 않는다.
