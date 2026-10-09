# 협업 도메인 DDD 개발 기준과 적용 계획

## 문서의 목적과 현재 결정

이 문서는 Hive의 핵심 도메인인 A2A/A2B 협업을 개발할 때 따를 DDD 기준과 현재 합의한 모델, 단계별 적용 계획을 함께 기록한다. 앞의 모델·계층 규칙은 개발 기준으로 사용하고, 뒤의 단계별 항목은 적용 순서 제안으로 사용한다. 문서 갱신 자체는 런타임 동작이나 저장 형식을 바꾸지 않는다. 저장소 전반의 계층 원칙은 [아키텍처 목표](./refactoring-goals.ko.md)를, 대화 경로 계약은 [A2A·A2B 흐름](./a2a-a2b-flows.ko.md)을 따른다.

- 협업(Collaboration)을 Hive의 핵심 bounded context로 둔다.
- A2A와 A2B는 Agent·Room·Task 모델과 비동기 실행을 공유한다. 차이는 별도 런타임이 아니라 상호작용 정책으로 표현한다.
- A2A는 한 흐름의 task 경로에서 이미 등장한 에이전트를 다시 거칠 수 있다. 반복 방문은 유효하고 `maxDepth`가 경로 길이를 제한한다.
- A2A callback은 새 root task로 실행될 수 있다. task 부모 계보의 깊이와 callback을 지나 유지되는 A2A 흐름 깊이는 서로 다른 값이다.
- A2B는 정확히 지정된 Bonded Agent 한 명에게 결합한다. 그 에이전트는 직접 완료하거나 원 요청자에게 한 번 callback할 수 있고, 다른 에이전트로 작업을 위임할 수 없다.
- 모든 요청은 비동기다. 접수는 저장과 실행 예약이 완료됐다는 뜻이며 provider 작업 완료를 뜻하지 않는다.

## 컨텍스트와 소유권

| 컨텍스트 | 책임 | 협업과의 관계 |
|---|---|---|
| 협업 `collaboration` | Room·Agent·Task·A2A 흐름·A2A/A2B 권한과 상태 규칙 | 핵심 도메인 |
| 세션 `session` | Hive session identity와 provider-native session 연결, 세션 수명주기 | Agent를 실행할 provider session 참조 제공 |
| Provider 통합 `provider` | capability, provider 공통 계약과 provider별 실행 연동 | Agent 작업 실행을 Application에 제공 |
| 대화 `conversation` | 사용자 대화와 transcript | 협업 결과를 transcript 통신 항목으로 투영 |
| Workspace / 실행 | workspace 의미, 파일·terminal 동작 | task 실행 환경을 Application 흐름에서 사용 |
| 실행 앱 / Infrastructure | daemon·CLI 실행 진입점, persistence·transport·process 구현 | 요청 흐름 조정, 직렬화, 저장 및 실행 구현 |

협업 규칙은 provider 프로토콜 DTO, MCP schema, HTTP 요청 객체에 의존하지 않는다. Presentation은 협업 정책을 재구현하지 않고 Application 경계에서 제공된 상태와 결과를 표시한다.

### Bounded Context 경계 규칙

`src/domain/collaboration`을 협업 모델의 유일한 소유 경계로 둔다. 이 안에서는 `Agent`, `Room`, `Task`, A2A flow, A2A/A2B, callback의 용어와 의미를 하나의 협업 모델로 일관되게 정의한다. 같은 단어가 다른 컨텍스트에서 다른 의미로 쓰일 수 있으므로, 이름이 같다는 이유로 Entity나 Value Object를 공유하지 않는다. 이 계층 계획은 포트와 어댑터를 중심으로 전 계층을 구성하는 헥사고날 아키텍처를 도입하지 않는다.

- 협업의 `Agent`는 Hive 협업에 참여하는 주체다. Provider가 표현하는 실행기·모델·agent profile과 같은 객체로 취급하지 않는다.
- Provider capability는 `provider`가 소유하고, 협업 정책에 필요한 Agent의 역할·허용 범위는 `collaboration`이 소유한다. 실행 가능 여부 확인은 Application이 두 컨텍스트의 계약을 조정한다.
- 협업 `TaskResult`와 대화 `Transcript`는 별도 모델이다. 결과를 대화에 표시할 때 Application이 명시적으로 투영하며 한 모델을 다른 컨텍스트에 그대로 전달하지 않는다.
- 협업 Agent가 참조하는 provider session은 ID나 외부 계약으로 연결한다. `Session` Entity를 협업 Aggregate 안에 넣지 않는다.
- 컨텍스트 간 요청·응답은 Application Use Case와 구체적인 typed 계약으로 전달하고, 외부 DTO나 다른 컨텍스트의 모델은 통합 경계에서 로컬 모델로 변환한다. Repository, 저장 snapshot, provider DTO를 컨텍스트 간 공유 계약으로 쓰지 않는다.

컨텍스트를 넘나드는 규칙은 어느 컨텍스트가 정책의 원천인지 먼저 정하고, 다른 컨텍스트는 필요한 사실만 계약으로 받는다. 한 컨텍스트의 변경으로 다른 컨텍스트의 Entity를 직접 수정하지 않으며, 후속 변경은 Application 조정이나 도메인 이벤트로 연결한다.

## 도메인 모델과 Aggregate 경계

### Aggregate roots

Aggregate는 한 트랜잭션에서 도메인 일관성을 보장하는 경계다. Aggregate마다 식별자를 가진 도메인 Entity인 root가 정확히 하나 있고, root와 root가 소유하는 0개 이상의 Value Object로 구성한다. 다른 Entity가 내부에 꼭 필요하다는 규칙이 확인되지 않으면 별도 Entity를 추가하지 않는다. root는 Aggregate 내부 변경의 유일한 진입점이며, 도메인 규칙을 적용해 내부 객체들의 불변식을 함께 지킨다.

| Aggregate root | 소유 상태와 행위 | 경계 규칙 |
|---|---|---|
| `Task` | task 요청, 상태, 결과·오류, parent/flow lineage, response delivery를 표현하는 값 | 자체 상태 전이와 요청·결과 정합성, `maxDepth`를 넘지 않는 flow depth를 보호한다. 자식 Task는 같은 Room에만 만들 수 있다. 다른 Task·Agent·Room은 ID로 참조한다. |
| `Agent` | 역할·capability·가용 상태를 표현하는 값 | Agent 상태 전이와 IDLE/WORKING/WAITING 상태에서 새 task를 받을 수 있는 규칙을 보호한다. 현재 task와 room은 ID로 참조한다. |
| `Room` | Agent ID 또는 멤버십 Value Object의 모음 | 멤버 추가·제거 규칙을 보호한다. Agent Entity를 내부에 중첩하지 않는다. |

이 경계에서는 각 Aggregate에 root Entity 하나만 둔다. `Room`의 멤버 항목처럼 별도 식별자와 독립 수명주기·상태 전이가 필요하지 않은 내부 모델은 Value Object로 둔다. 둘 이상의 Entity가 필요하다는 제안은 각 Entity의 식별성, 생성·변경·삭제 시점, 독립 조회 필요성과 root가 지켜야 할 불변식을 먼저 확인한 뒤 예외로 다룬다. 변경 주체와 생성·변경 시점이 함께 움직이는지는 경계 후보를 찾는 단서지만, 같은 Aggregate로 묶을지는 원자적으로 지켜야 할 일관성 규칙을 기준으로 결정한다.

A2A 흐름은 callback으로 새 root task가 생성되어도 여러 Task aggregate를 가로지르는 상관관계다. 첫 단계에서는 `FlowId`와 깊이 값 객체로 표현하고 별도 Aggregate로 만들지 않는다. 별도 흐름 수명주기와 불변식이 발견되면 Task ID를 참조하는 `Flow` Aggregate를 검토할 수 있다. 기존 여러 Task Aggregate를 한 번에 수정하려는 목적만으로 Flow root를 덧씌우지 않는다. task들 사이에 원자성이 꼭 필요하다면 먼저 Task 경계를 다시 검토한다.

### Task

초기 aggregate 경계는 **task 하나당 하나의 Task aggregate**로 둔다. `Task` root가 식별자와 요청·대상·상태·결과·오류 및 허용된 상태 전이를 소유하고, 해당 상태에 필요한 전달·계보 값은 Value Object로 둔다. 부모 task, room, source agent와 target agent는 식별자로 참조한다. 다른 Task를 자식 Entity로 객체 그래프에 포함하지 않는다.

```text
QUEUED  -> RUNNING | FAILED | CANCELLED | TIMED_OUT
RUNNING -> WAITING | COMPLETED | FAILED | CANCELLED | TIMED_OUT
WAITING -> RUNNING | FAILED | CANCELLED | TIMED_OUT
COMPLETED / FAILED / CANCELLED / TIMED_OUT -> terminal
```

`WAITING`은 기존 `a2a_wait_task` 호환 경로가 사용하는 상태다. 새 비동기 A2A/A2B 요청은 접수 후 `QUEUED`로 저장되며, 부모가 하위 task 결과를 기다리는 상태를 기본 흐름으로 만들지 않는다. 호환 경로를 제거하기 전까지 `WAITING`을 유지한다.

### Agent와 Room

Agent 상태 및 실행 가용성과 Room 멤버십은 각각 독립된 책임으로 유지한다. Agent root는 현재 상태와 전달된 adapter 동시 실행·queue 허용 사실을 바탕으로 `canAcceptTask`를 판단한다. Application은 provider capability, session, room membership과 후보 순위를 조회하고 root에 필요한 사실을 전달한다. Task aggregate가 Agent나 Room 전체를 포함하지 않으며, room 멤버십·호출자·대상 확인은 Application 조회 service/use case가 조정한다. 멤버십 자체가 별도 생명주기나 규칙을 갖지 않는 동안에는 `Room` 내부의 Agent ID 또는 멤버십 Value Object로 표현한다.

### 흐름 상관관계와 깊이

- `parentTaskId`, `rootTaskId`, `task.depth`는 task parent-child 계보를 나타낸다.
- A2A 흐름 ID와 흐름 깊이는 callback이 새 root를 만들더라도 요청·응답 상관관계를 유지한다.
- `visitedAgents`는 단일 parent-child 경로의 **순서가 있는 방문 목록**이다. 집합이 아니므로 A2A에서 재방문한 agent ID가 반복될 수 있다.
- callback으로 새 root가 시작되면 task 계보 깊이는 새로 시작할 수 있지만, 흐름 ID와 흐름 깊이는 이어진다.
- `maxDepth`는 task 계보 깊이와 callback을 포함한 A2A 흐름 깊이에 각각 적용한다. Task root 복원·생성 시 flow depth가 이 한도를 넘지 않는지 검증하고, parent root는 자식이 같은 Room에 속하는지 판단한다.

전체 task tree나 callback이 이어지는 전체 흐름을 첫 단계부터 하나의 거대한 aggregate로 만들지 않는다. 흐름의 독립 수명주기가 확인되면 Flow Aggregate는 자체 상태와 Task ID를 소유하는 별도 경계로 검토한다. 여러 Task Aggregate의 변경을 하나의 Flow에 담아 원자 처리하려는 경우에는 먼저 task 단위 경계 자체가 잘못되었는지 확인한다.

### Value Objects

Value Object는 식별자보다 값 자체로 비교하며 생성 뒤 바꾸지 않는다. 생성 시 도메인 형식과 범위를 검증하고, 값이 같으면 동등하게 취급한다. Aggregate가 전달받거나 내보내는 중첩 metadata와 결과도 복사해 외부 객체 참조가 root 내부 상태를 바꾸지 못하게 한다.

| Value Object | 의미와 규칙 |
|---|---|
| `TaskId`, `AgentId`, `RoomId`, `FlowId` | 서로 혼용하지 않는 검증된 도메인 식별자 |
| `TaskDepth`, `FlowDepth` | 각각 task 계보와 callback 포함 흐름의 0 이상 깊이. 둘을 같은 숫자 필드로 취급하지 않음 |
| `AgentPath` | task 계보의 순서 있는 agent 방문 경로. 재방문 ID를 허용하고 부모 경로 prefix를 유지 |
| `InteractionMode` | 최초 상호작용이 A2A인지 A2B인지 나타냄 |
| `TaskDelivery` | `a2a-async-request`, `a2a-result-delivery`, `a2a-result-callback`, `a2b-bonded-request`만 허용하는 불변 전달 값 |
| `TaskResult` | 완료 상태에 연결되는 불변 결과와 artifact 값 |

`InteractionMode`와 `TaskDelivery`는 서로 다른 값이다. A2B 요청에 대한 callback은 bonded 요청의 응답 전달이지 새로운 A2B 위임이 아니다. 저장된 `metadata.delivery` 문자열은 persistence mapper가 Value Object로 변환하며 기존 snapshot 형식을 유지한다.

값 객체를 모든 문자열·숫자에 기계적으로 만들지 않는다. 형식 검증, 범위 규칙, 값 비교 또는 관련 행위가 필요한 개념만 별도 타입으로 둔다. TypeScript에서는 immutable value class나 검증 factory를 사용하고 public field를 수정하지 못하게 한다.

### Domain Service와 Policy

Domain Service는 한 Entity나 Value Object가 자연스럽게 소유하기 어려운 도메인 결정을 표현한다. 여러 도메인 모델을 함께 고려해야 하더라도 실제 업무 규칙이나 선택이 있어야 추출한다. Entity에 여러 메서드를 순서대로 호출한다는 사실만으로 Domain Service를 만들지는 않는다. 규칙과 상태 변경을 한 Aggregate root가 온전히 지킬 수 있으면 그 행위는 root에 둔다.

DDD는 순수한 Domain Service와 외부 결과에 의존하는 Domain Service를 모두 허용한다. Hive는 헥사고날 아키텍처나 범용 port/adapter 계층을 도입하지 않으므로 현재는 순수한 Domain 모델을 기본으로 한다. 외부 결과가 업무 판단의 근거가 되더라도 Application이 그 사실을 조회해 DTO 또는 도메인 값으로 전달하고, Domain이 규칙에 따라 판단한다. 외부 효과 자체는 Application이 조정한다. Domain 안에서 외부 동작을 직접 수행해야만 규칙을 보존할 수 있는 구체 사례가 생기면 실패·재시도·중복 실행 의미를 포함해 별도 설계로 기록한다.

- 여러 Aggregate의 사실을 함께 평가하는 순수 규칙은 `Domain Policy`로 이름 붙일 수 있다. 동작을 수행하는 도메인 서비스와 정책 이름은 구분하되 모두 Domain 계층에 둔다.
- Agent 대상 선택처럼 selector, 방문 경로, Agent 상태·capability, 부하를 함께 평가하는 규칙은 `AgentTargetSelectionPolicy`가 소유한다. Application은 adapter·session의 실행 가능 사실을 수집해 후보 입력으로 전달하고, 정책은 후보 적격성과 순위를 결정한다.
- A2A flow ID와 callback을 잇는 flow depth 계산은 `TaskFlowPolicy`가 소유한다. Application은 parent·callback·root task 참조를 Repository에서 읽어 입력 facts로 전달하며, Domain 정책은 저장소 조회 없이 계보 관계를 해석한다.
- Domain Service/Policy는 Repository 조회·저장, 네트워크, 파일, provider 실행, process 제어를 하지 않는다. 상태를 소유하는 Entity도 아니므로 보통 무상태로 둔다.
- 정책에 외부에서 얻은 사실이 필요하면 Application이 해당 Aggregate나 외부 정보를 조회하고, 필요한 값 또는 도메인 모델을 Domain Service/Policy에 전달한다. 도메인은 전달받은 사실로 결정을 내리고, Application은 그 결과에 따라 후속 Use Case나 외부 동작을 조정한다.
- Application에서 Domain으로 전달되는 계약과 Use Case/Application Service 간 전달값은 DTO로 표현한다. DTO를 Domain 모델로 변환한 뒤 규칙을 실행하며, Domain 작업에 Aggregate나 Value Object가 필요한 경우 이를 억지로 DTO로 바꾸지 않는다.
- Application이 Domain의 결괏값에 따라 호출을 이어가거나 멈추는 것은 흐름 조정이다. 다만 Aggregate 불변식은 해당 root의 명령 메서드에서도 강제해 호출 순서나 Application 분기에만 의존하지 않는다.
- 협업의 callback 권한·전달 유형 판정처럼 여러 입력을 조합하는 규칙은 순수 `InteractionPolicy` 후보로 둔다. Task 상태 전이는 `Task` root가 보호한다. 그 밖의 Domain Service는 실제 중복되거나 한 모델에 둘 수 없는 도메인 결정이 확인될 때 추가한다.
- A2A 요청 task가 응답 전달 없이 `COMPLETED`가 될 수 있는지는 `InteractionPolicy`가 판정한다. Application은 이미 저장된 결과 전달/callback task가 있는지 조회해 사실을 전달하고, 정책 결과에 따라 결과 상태를 적용한다.

#### 결정과 조율을 나누는 기준

코드의 줄 수나 `if`문 유무로 Domain Service 여부를 정하지 않는다. 누가 업무상 유효한 선택을 내리고 Aggregate 불변식을 끝까지 보장하는지로 판단한다.

| 상황 | 책임 | 협업 도메인에서의 예 |
|---|---|---|
| 한 Aggregate의 상태·정책만으로 유효성을 판단할 수 있음 | Aggregate root가 판단하고 명령 안에서도 불변식을 강제 | `AgentAggregate`가 현재 상태와 adapter 실행 가능 사실을 확인해 task 생성 여부를 결정 |
| 여러 Aggregate의 사실이나 정책을 함께 평가해야 함 | 순수 Domain Service/Policy가 판단하고, 필요한 사실 조회는 Application이 담당 | 호출자·대상 task·Room·flow 관계를 입력받아 callback 권한과 수신자를 판정 |
| 외부 시스템의 결과가 업무 판단의 입력임 | Application이 외부 호출과 결과 조회를 조정하고, 검증된 결과 사실을 DTO 또는 Value Object로 Domain에 전달해 Domain이 업무 결과를 판단 | provider 실행 결과와 기존 task 상태를 근거로 결과 반영 가능 여부를 결정 |
| 도메인 객체에 정해진 순서로 명령을 보내고 조회·저장·예약을 수행함 | Application Use Case/Service가 조율 | Task를 저장한 뒤 provider 실행을 예약하고 접수 DTO를 반환 |

외부 결과를 기다려야만 내릴 수 있는 판단도 Application의 분기문에 업무 규칙으로 남기지 않는다. Application은 provider 결과를 Hive가 이해하는 값으로 변환해 Domain에 전달하고, Domain은 그 값과 Aggregate 상태로 허용되는 전이·결과를 결정한다. provider 호출, 저장, 실행 예약과 그 순서는 계속 Application/Infrastructure 경계가 담당한다. Aggregate 명령은 Application의 사전 검사나 분기와 별개로 자신의 불변식을 다시 확인한다.

Hive에서는 외부 효과를 Application/Infrastructure 경계에서 실행한다. 외부 결과에 근거한 업무 판단은 필요한 사실을 전달받은 Domain 모델이 내린다. 외부 의존성 전부를 범용 port/adapter로 감싸지는 않는다.

## Application Use Case와 Service

Use Case는 외부 요청이나 시스템 이벤트 하나에 대한 협업 동작을 표현한다. Application Service는 여러 Use Case를 조합해 상위 흐름을 만들고, 호출 순서·트랜잭션 경계·필요한 Infrastructure 연동 호출을 조정한다.

Application Service 자체는 도메인 규칙의 소유자가 아니다. Task 상태 전이, callback 권한, A2A/A2B 제한과 같은 정책 판단 및 Aggregate 불변식은 Domain Entity/Aggregate, Value Object, Domain Service/Policy가 소유한다. Application은 Repository로 root를 가져오고 Domain 동작을 호출한 다음 결과를 외부 계약으로 변환한다. 협업의 현재 task 접수·실행·callback 동작은 Use Case로 두며, 반복되는 여러 Use Case 조합이 확인될 때 Application Service로 묶는다. Infrastructure 연동은 필요한 기능에 맞는 구체 API를 사용하며 이를 범용 port/adapter 체계로 재구성하지 않는다.

### Application DTO 경계

Application 계층을 통해 전달되는 데이터는 DTO를 기본으로 한다. 각 Use Case의 요청·응답, Application Service 간 호출, 이벤트, provider·runtime 등 구체 통합 모듈과 주고받는 요청·결과를 DTO로 표현한다. Application Service가 Use Case를 조합할 때도 요청 DTO와 응답 DTO를 주고받는다. daemon API 계약 DTO는 `src/application/dto/daemon`에, daemon 요청 검증과 Use Case 연결은 `src/application/services/daemon-api`에 둔다. CLI 입력과 terminal 표현은 `apps/cli`, 모바일 RPC server는 `apps/daemon`, 실제 네트워크 protocol 구현은 Infrastructure가 담당한다. DTO는 전달 구조만 담고 비즈니스 판단이나 Aggregate 불변식을 구현하지 않는다.

Use Case는 요청 DTO를 Domain 식별자·Value Object·명령 인자로 변환하고 Repository에서 Aggregate를 조회해 도메인 동작을 호출한다. Aggregate와 Value Object는 Application이 도메인 규칙을 실행하고 Repository에 저장하기 위해 내부에서 다룬다. Domain Repository는 DDD 계약에 따라 DTO가 아니라 Aggregate를 저장·복원한다. 이 도메인 작업 데이터는 Application 간 전달 DTO를 대신하지 않는다. Aggregate와 Value Object를 Use Case 입·출력, Application Service 간 요청·응답, 외부 통합 계약, Presentation 또는 wire 계약으로 직접 노출하지 않는다. Query 결과도 화면이나 외부 계약에 맞는 DTO로 반환한다.

저장 snapshot은 기존 저장 형식을 보존하는 persistence 계약 DTO로 취급한다. Application의 state-store 계약에 필요한 snapshot 타입은 Application DTO로 선언하고, 실제 JSON shape와 레코드 간 일관성 검증은 Infrastructure persistence가 맡는다. Snapshot JSON을 Domain Aggregate 그 자체로 사용하지 않는다. provider session, runtime map, Aggregate가 같은 필드를 필요로 하더라도 각 경계가 소유한 DTO와 모델로 변환한다.

따라서 “Application에서 사용하는 데이터는 DTO”라는 원칙은 Application 계약과 계층 간 전달값의 기본 형식을 뜻한다. Use Case 안에서 도메인 규칙을 호출하는 순간까지 Aggregate를 DTO로 바꾸거나, Domain Repository를 DTO 기반 저장소로 바꾸라는 의미는 아니다. 반대로 편의를 이유로 Aggregate를 다른 Use Case나 외부 통합에 그대로 넘기지 않는다.

### Application 조율과 Domain 판단의 구분

Application Service와 Domain Service는 이름이 비슷해도 책임이 다르다. Application Service는 외부 요청 하나에 대한 Use Case들을 조합하고, 조회·저장·외부 실행의 순서와 트랜잭션을 조정한다. Domain Service/Policy는 한 Aggregate가 자연스럽게 소유하지 못하는 실제 업무 판단을 수행한다. 도메인 객체의 메서드를 순서대로 호출하는 코드, 단순한 조건 분기 또는 코드 줄 수만으로 Domain Service를 추출하지 않는다.

업무 판단이 없는 단순 CRUD는 Application Use Case와 Repository 호출로 충분하다. 풍부한 Domain Model이나 Domain Service를 형식적으로 만들지 않는다. Application Service가 복잡해 보여도 먼저 외부 흐름 조정인지 도메인 결정인지 구분하고, 실제 결정을 Domain으로 옮긴다.

Use Case의 기본 흐름은 다음과 같다.

1. 요청 DTO를 받고 Repository와 필요한 구체 통합 모듈에서 Aggregate·외부 사실을 조회한다.
2. Domain Entity, Value Object 또는 Domain Service/Policy에 판단과 상태 변경을 요청한다.
3. Application이 반환된 결정에 따라 저장, provider 실행 예약, 이벤트 발행 등 외부 효과를 조정한다.
4. 결과를 응답 DTO로 변환한다.

예를 들어 A2B 요청에서 Application은 호출자·Room·지정 Agent를 조회하고, Domain Policy가 대상 고정과 권한을 판정하며, Task Aggregate가 유효한 요청 상태를 만든다. Application은 task를 저장하고 실행을 예약한 뒤 접수 결과 DTO를 반환한다. 실행 완료를 기다리지 않는 접수 응답과 나중에 `replyToTaskId`로 상관관계를 잇는 callback은 별도 Use Case다. callback을 보내는 권한과 원 요청당 1회 제한은 Domain 규칙으로 지키고, 조회·저장·예약은 Application이 조정한다.

업무 판단에 provider나 다른 외부 시스템의 결과가 필요하더라도, 기본 경로는 Application이 해당 사실을 조회하고 결과를 DTO 또는 도메인 값으로 Domain에 전달해 판단시키는 방식이다. 이 계획에서는 Domain Service가 Repository·network·provider gateway를 직접 호출하거나 Entity에 주입되는 구조를 기본으로 채택하지 않는다. 외부 효과와 업무 판단을 원자적으로 엮어야 하는 요구가 실제로 발견되면 별도 사례와 실패·재시도 규칙을 문서화해 설계한다. 그 필요성만으로 범용 포트·어댑터 계층을 도입하지 않는다.

## Entity와 Repository 패턴

### Entity

도메인 Entity는 안정된 식별자와 그 식별자에 속한 상태 전이 규칙을 함께 소유한다. 첫 적용에서는 공통 기반 클래스나 범용 Entity 프레임워크를 만들지 않고, 작은 TypeScript 클래스로 실제 행위와 불변식을 캡슐화한다.

- `Task`, `Agent`, `Room`은 각각 `TaskId`, `AgentId`, `RoomId`를 가진 Aggregate root Entity다. ID는 생성 후 바뀌지 않는다.
- Entity 명령은 상태 전이와 root 내부 불변식을 검증한다. Repository는 Entity의 행위를 대신하지 않고 Entity를 저장·복원한다.
- Provider adapter ID나 native process/session handle은 외부 응답 모델로 노출하지 않는다.
- 식별자와 흐름 값 규칙에는 앞서 정의한 Value Object를 사용하고, 저장된 string 값은 경계 mapper에서 변환한다.
- 각 Aggregate에는 root Entity 하나만 둔다. 여러 Aggregate 사이의 규칙은 Application use case가 각 root를 불러 조정한다. Aggregate 객체를 직접 서로 중첩해 로드하지 않는다.
- MCP/daemon DTO, provider DTO, snapshot JSON은 Entity가 아니다. 외부 입력과 저장 데이터를 경계에서 검증한 뒤 Entity를 만들거나 복원한다.

Entity 메서드는 도메인 규칙만 수행한다. 시계, 파일, 네트워크, provider 호출, task 실행 예약은 인자로 필요한 값만 받거나 Application이 처리한다. Repository는 Entity의 상태 전이를 대신하지 않는다.

### Repository와 트랜잭션

Entity와 Value Object가 도메인 요구사항에서 도출되는 모델이라면 Repository 계약은 Aggregate 영속화를 위한 도메인 추상화다. Repository도 Domain 모델의 일부이므로 `TaskRepository`, `AgentRepository`, `RoomRepository` 인터페이스를 `src/domain/collaboration/repositories`에 둔다. 이 DDD Repository 패턴은 헥사고날 아키텍처를 채택한다는 뜻이 아니다. 별도의 범용 ports 계층을 만들지 않는다. Repository는 aggregate root ID를 기준으로 하나의 Aggregate를 읽고 저장·복원하는 경계를 제공한다. Aggregate를 수정하려면 그 root ID로 Aggregate 전체를 불러오고, 저장 시에도 해당 Aggregate를 일관성 단위로 저장한다. 이 인터페이스는 Domain 타입만 다루고 저장 기술을 알지 않는다. 구체적인 파일·메모리 구현은 Infrastructure에 둔다. Domain Entity와 Repository 계약은 Infrastructure를 import하지 않는다. Application은 Domain Repository를 유스케이스에서 사용하며, 외부 실행 기능은 기존 Infrastructure 통합 모듈의 구체적인 typed API를 이용한다.

```text
TaskRepository   -> Task aggregate
AgentRepository  -> Agent aggregate
RoomRepository   -> Room aggregate
```

각 Repository의 명령 경로는 자기 Aggregate의 root ID 조회와 저장으로 제한한다. Task graph, 응답 전달 여부, Agent 대기열 부하처럼 현재 필요한 읽기는 목적이 드러나는 Task Repository query로 제공하고 Application query service/use case가 결과를 조정한다. 범용 `findAll()`을 제품 query에 사용하지 않는다. 전체 runtime snapshot 재구성용 task list는 Application의 `A2ATaskSnapshotSource`가 Application DTO로 제공하며 Domain Repository에는 collection-export 메서드를 두지 않는다. provider 실행, transport 호출, task queue 및 UI 상태를 Repository에 넣지 않는다. `TaskFlow`를 Aggregate로 승격하기 전에는 별도 `FlowRepository`를 만들지 않는다. 여러 Aggregate를 묶는 검색은 Application query service/use case가 projection, join 또는 pagination으로 조정하며 Domain Aggregate 간 필드 참조를 추가하지 않는다.

#### Aggregate 간 참조와 조회

한 Aggregate 안에 다른 Aggregate root 객체를 필드로 보관하지 않는다. 필요한 관계는 `TaskId`, `AgentId`, `RoomId` 같은 식별자로 표현하고, 다른 Aggregate의 상태가 필요할 때 Application이 해당 Repository나 목적별 query를 통해 조회한다. 이렇게 하면 Aggregate 하나의 명령이 다른 Aggregate를 우발적으로 변경하는 일을 막고, 각 Aggregate를 서로 다른 저장 기술로 옮길 수 있으며, 객체 그래프 전체를 로드할지에 대한 판단을 도메인 모델 밖에 둘 수 있다.

도메인 개념상 1:N 또는 M:N 관계가 있다고 해서 이를 같은 모양의 객체 참조 컬렉션으로 구현하지 않는다. 예를 들어 Room은 Agent Aggregate들을 중첩해 소유하지 않고 Agent ID 또는 멤버십 Value Object를 보유한다. Room의 Agent 목록이나 Agent의 Task 이력처럼 결과가 많아질 수 있는 화면·운영 조회는 필요한 필드만 담은 query DTO로 반환하고 페이지 단위로 읽는다. 다수의 root가 필요한 조회는 Application query 경계에서 일괄 조회·projection·join을 사용해 N+1 조회를 피할 수 있으며, 이 read query가 Aggregate 명령 경계나 Domain Repository의 범용 `findAll()`이 되지는 않는다.

Callback 권한은 caller, 대상 task, room, flow 관계를 입력으로 받는 순수 협업 Domain policy가 판정한다. Repository 조회는 Application이 수행하며 Entity와 Domain policy는 Repository를 직접 호출하지 않는다. 원 요청 task별 callback 1회 제한은 원 요청 `Task` Aggregate가 reservation·commit 상태로 강제한다. Application은 callback task 저장이 실패하면 예약을 해제하고, callback task가 저장된 경우 root의 제한을 확정한다. Snapshot JSON에 새 필드를 추가하지 않고 복원 시 callback task의 기존 `metadata.callbackForTaskId`에서 root 제한을 재구성한다. callback 생성은 별도 Task Aggregate이므로 두 root를 한 트랜잭션으로 수정하는 요구는 아니다. 장기적으로 저장 실패 후 재시도 보장이 필요해지면 신뢰성 있는 도메인 이벤트/outbox를 검토한다.

하나의 트랜잭션에서 둘 이상의 Aggregate를 수정하는 것은 피한다. 한 Aggregate의 변경이 다른 Aggregate의 변경을 직접 호출하지 않게 하고, 가능한 경우 도메인 이벤트와 비동기 후속 use case로 연결한다. 이벤트·비동기를 쓸 수 없고 동기 처리가 꼭 필요한 경우에는 Application use case가 각 Repository와 root를 명시적으로 조정한다. 이 예외도 root가 다른 Aggregate를 참조하거나 변경하게 만들지 않으며, 여러 Aggregate를 원자적으로 저장해야 하는 요구는 별도 근거와 트랜잭션 범위로 문서화한다.

현재 동기 조정 예외는 두 흐름이다. Agent 등록은 `A2AAgentRegistration`이 Agent root 생성과 Room root 멤버십 추가를 조정한 뒤 기존 전체 snapshot을 저장한다. Task 실행·종료는 `A2ATaskExecutor`가 Task 상태와 Agent 가용 상태를 함께 갱신한 뒤 같은 snapshot commit을 수행한다. 두 흐름 모두 Aggregate가 다른 Aggregate를 직접 변경하지 않고 Application이 각 Repository를 통해 조정한다. 기존 snapshot은 전체 runtime projection을 한 파일에 원자적으로 기록하므로 이 저장 형식을 유지하는 동안에는 이 경계를 사용한다. 독립 저장소나 비동기 projection으로 전환할 때는 두 흐름의 일관성·실패 복구 계약을 먼저 다시 설계한다.

서로 다른 Aggregate의 상태가 함께 변하는지, 변경의 주체와 생성·변경 시점이 같은지는 경계 재검토의 신호로 본다. 다만 읽기 편의나 객체 탐색을 이유로 Aggregate를 합치지 않는다. 동시성 아래에서 반드시 함께 지켜야 하는 불변식이 무엇인지 먼저 적고, 그 불변식이 한 root 안에 있는지 검증한다.

### Aggregate 간 생성 팩토리

기존 Aggregate의 도메인 상태가 다른 Aggregate를 만들 수 있는지를 결정하는 규칙을 소유한다면, 그 Aggregate가 factory method를 제공할 수 있다. Application은 필요한 root를 ID로 조회해 factory에 전달하고, factory는 Domain 규칙을 검증해 새 Aggregate를 만들되 Repository 조회·저장, 외부 호출, 다른 Aggregate 변경은 수행하지 않는다. 새 Aggregate의 저장과 트랜잭션 조정은 Application이 담당한다. Hive에서는 Task 수신 가능 여부가 Agent 상태와 adapter의 동시 실행·queue 허용 사실에 달려 있으므로 `AgentAggregate.createTask`가 이 규칙을 확인한 뒤 `TaskAggregate`를 만든다. Application scheduler는 provider·session을 선택하고 adapter capability 사실을 전달한 다음 새 root를 Repository에 저장한다. Agent는 생성한 Task를 소유하거나 조회하지 않는다.

현재 `A2ARuntimeStateStore`는 호환을 위해 전체 snapshot을 대상으로 하는 기존 Application persistence 계약이다. Domain의 root ID 기반 Repository는 이를 대체하지 않고 Aggregate 행위와 저장 경계를 표현한다. `A2ARuntimeStatePersistence`는 `A2ATaskSnapshotSource`가 제공하는 Task record DTO와 Directory의 Agent·Room projection을 기존 Application snapshot DTO로 모아 순서대로 저장한다. 물리 저장 단위는 기존 전체 snapshot이고 형식은 변경하지 않는다. 이 경계만으로 aggregate마다 별도 파일이나 DB 테이블을 만들 필요는 없다.

Infrastructure persistence 구현은 JSON을 `unknown`으로 받아 snapshot shape와 레코드 간 참조를 검증하고 기존 snapshot JSON shape로 저장한다. `SnapshotTaskRepository`, `SnapshotAgentRepository`, `SnapshotRoomRepository`는 root ID별 process-local identity map을 유지하고 변경된 root를 기존 전체 snapshot에 write-through 한다. 재시작 복원은 Application이 snapshot DTO를 검증한 뒤 Aggregate로 복원해 Repository에 적재한다. Repository별 독립 파일/DB 저장소는 추가하지 않으며 snapshot 파일 형식도 변경하지 않는다. Entity factory는 도메인 값의 불변식을 검사한다.

## 상호작용 정책

| 규칙 | A2A | A2B |
|---|---|---|
| 최초 대상 | 허용된 room agent | 같은 room에 등록된 정확한 Bonded Agent ID |
| 추가 위임 | 가능. 각 수신 agent가 다음 경로를 선택 | 금지 |
| 직접 완료 | 가능 | Bonded Agent가 직접 완료 가능 |
| 결과 callback | 같은 A2A 흐름의 권한 있는 task 발신자를 대상으로 가능 | Bonded Agent만 원 요청자에게 한 번 가능 |
| 결과 전달 | 선택한 다른 agent에게 전달하거나 callback | 다른 대상·selector·재위임을 허용하지 않음 |
| 접수 결과 | 저장·예약 완료 후 task ID 반환 | 동일 |

현재 transport 입력은 `replyToTaskId`를 받으며 Application 경계에서 결과 전달과 callback 상관관계로 변환한다. 내부 정책은 일반 새 요청, 결과 전달, 요청자 callback, bonded 요청을 구분해야 한다. Prompt 문구는 agent에게 지침을 제공하지만 권한 판단은 모든 실행 진입점에서 runtime 규칙으로 수행한다.

## 현재 `src` 경로와 책임

현재 저장소의 top-level 계층을 유지하면서 협업 도메인 모델은 bounded context 안에 둔다. 기존 파일을 단지 아래 트리 모양에 맞추려고 이동하지 않는다.

```text
src/domain/collaboration/
  aggregates/       Agent·Room·Task root와 Aggregate record
  value-objects/    식별자, 계보, 전달, 결과의 검증된 불변 값
  policies/         상호작용 권한, 대상 선택, task flow 판단
  repositories/     Aggregate root ID 조회·저장을 위한 Domain 계약

src/application/
  dto/              Use Case 입·출력, 서비스 간 전달, runtime/snapshot 계약
  mappers/          DTO·Domain·기존 projection 사이의 명시적 변환
  use-cases/        접수, 실행, callback, 취소, 복구, 조회 등 작업 흐름
  ports/            provider/runtime 등 구체 기능에 필요한 typed 계약

src/infrastructure/
  persistence/      Domain Repository 구현, snapshot 검증·저장
  composition/      실행 환경별 구체 구현 조립

src/application/dto/daemon/             daemon API request/response typed contracts
src/application/services/daemon-api/    daemon 요청 검증과 Use Case 연결
src/presentation/                       desktop·Android 공용 화면과 사용자 상호작용
apps/cli/src/                           CLI 명령, terminal 출력, 진입점과 실행 조립
apps/daemon/src/                        daemon 전용 RPC server와 실행 조립
```

협업 관련 실제 파일은 `src/domain/collaboration`의 Aggregate·Value Object·Policy·Repository 계약, `src/application/dto/a2a-collaboration.ts` 및 `a2a-runtime-snapshot.ts`, `src/application/mappers/a2a-collaboration-mapper.ts` 및 `a2a-agent-mapper.ts`, `src/application/use-cases/a2a-*.ts`, `src/infrastructure/persistence/a2a-collaboration-repositories.ts`와 snapshot 저장 모듈에 위치한다. Application DTO의 다른 예시는 `src/application/dto/assistant.ts`, `a2a-communication.ts`, `transcript-cache.ts`, `prompt.ts`, `workspace.ts`, `session-identity.ts`다. provider catalog 변환은 `src/application/mappers/assistant-catalog-mapper.ts`가 담당한다. Use Case는 기능별 파일로 나눈다. 여러 Use Case를 조합하는 Application Service는 실제 반복되는 조합 책임이 생길 때만 별도 모듈로 추가하며, 모든 Use Case에 wrapper service를 만들지 않는다.

`src/application/ports`라는 디렉터리가 존재한다는 사실은 모든 외부 의존성을 ports-and-adapters 방식으로 감싸야 한다는 뜻이 아니다. provider 실행, timer처럼 구체 기능에 필요한 계약만 둔다. 일반화된 포트 계층을 만들거나 각 구현을 일대일 어댑터로 복제하지 않는다.

## 논리적 모듈 배치 예시

기존 top-level 계층은 유지하고 협업 책임만 컨텍스트 아래에 모은다.

```text
src/domain/collaboration/
  aggregates/
    agent.ts                 Agent Aggregate root
    room.ts                  Room Aggregate root
    task.ts                  Task state, request, result, record types
    task-aggregate.ts        Task Aggregate root
  value-objects/
    identifiers.ts           TaskId, AgentId, RoomId, FlowId
    task-lineage.ts          TaskDepth, FlowDepth, AgentPath
    task-delivery.ts         InteractionMode, TaskDelivery
    task-result.ts           TaskResult와 artifact 값
  policies/
    interaction-policy.ts   순수 A2A/A2B 권한·전달 정책
    agent-target-selection-policy.ts  협업 Agent 후보 적격성·순위 정책
    task-flow-policy.ts      callback을 포함한 A2A 흐름 상관관계·깊이 정책
  repositories/
    agent-repository.ts     Agent Aggregate 영속성 계약
    room-repository.ts      Room Aggregate 영속성 계약
    task-repository.ts      Task Aggregate 영속성 계약

src/application/use-cases/                 작업별 Use Case와 DTO 계약
src/application/services/                  필요가 생길 때만 두는 선택적 조합 모듈
src/application/use-cases/a2a-runtime-state-persistence.ts
                                          Repository root를 snapshot DTO로 모아 저장

src/application/dto/daemon/             daemon API typed contracts
src/application/services/daemon-api/    요청 검증과 Use Case dispatch
src/infrastructure/                     provider·persistence·transport·runtime 구현
  persistence/                           Repository 구현과 snapshot mapping
apps/cli/src/                            CLI 입력, terminal presentation, 실행 진입점
apps/daemon/src/                         daemon RPC server와 실행 진입점
```

논리적 배치는 책임을 찾기 위한 예시다. 현재의 `a2a-*` Use Case 파일을 `collaboration/` 하위로 일괄 이동하는 작업을 뜻하지 않는다. 이미 구체적인 파일 경계가 있는 코드를 단순히 이 경로로 옮기지 않는다. 파일 이동만을 목적으로 facade나 재수출 모듈을 만들지 않는다. 모듈을 나눌 때는 규칙이나 상태를 실제로 소유하게 하고 직접 소비자를 함께 갱신한다.

## 단계별 적용 계획

1. **계약 고정.** A2A 재방문, 두 깊이 값, A2A callback, A2B의 단일 대상·비위임·단일 callback, 비동기 접수 의미를 문서와 코드에서 같은 용어로 사용한다.
2. **Aggregate·Entity·Value Object·Policy 정리.** Task·Agent·Room root와 불변식, ID·깊이·경로·전달 의미의 immutable Value Object, A2A/A2B 권한, Agent target eligibility/ranking, callback을 포함한 A2A flow identity/depth 계산을 Domain에서 표현한다. Application은 adapter·session·related task 사실을 전달하며 transport 조회와 저장, 예약은 Domain에 넣지 않는다.
3. **Domain Repository와 Application Use Case/Service.** aggregate root별 Repository 계약을 Domain에 둔다. 요청 접수, 결과 전달, callback, 실행, 취소, task 조회를 Use Case로 정리하고 여러 Use Case를 조합하는 반복 흐름만 Application Service로 구성한다. 외부 실행과 조회는 기존의 구체적 통합 모듈을 사용하고 별도의 범용 ports 계층은 만들지 않는다. 도메인 규칙은 Domain에 남기며 callback 중복 방지와 저장 후 접수 응답의 순서를 보존한다.
4. **Persistence와 provider 통합.** 파일·상태 저장 구현과 provider protocol 변환은 Infrastructure에 둔다. Infrastructure가 Domain Repository를 구현하고 JSON snapshot의 shape·참조 검증을 소유한다. 기존 snapshot state-store 계약을 바꾸지 않는 경계 매핑은 Application DTO mapper가 맡고, 별도 durable Repository 구현이 추가되면 Infrastructure가 저장 레코드와 Aggregate를 매핑한다. 기존 `metadata.delivery`, snapshot 필드, daemon/MCP/HTTP 계약을 내부 모델과 매핑하며 저장·wire 변경은 별도 호환 계획 없이는 하지 않는다.
5. **불일치 해소와 회귀 검증.** snapshot persistence 검증은 Infrastructure 경계에서 방문 경로의 순서·길이·parent prefix를 검사하되 재방문 ID를 중복이라는 이유만으로 거부하지 않도록 맞춘다. 재방문 경로, callback 새 root의 흐름 깊이, 중복 callback의 원자적 접수, A2B 대상 고정·재위임 거부, 기존 snapshot 복원을 확인한다.

한 번에 한 책임을 옮기고 현재 진행 중인 작업 트리의 변경을 보존한다. 문서 계획을 구현할 때도 기존 task 상태·이벤트 순서, provider 실행 의미, 저장 데이터와 외부 계약을 유지한다.

## 현재 적용 상태

아래는 2026-10-09 기준 코드의 적용 상태다. 설계 원칙과 순차 적용 제안은 위 절을 따르고, 실제 검증 이력과 미확인 범위는 [리팩터링 체크포인트](./refactoring-checkpoint.ko.md)에 기록한다.

- `src/domain/collaboration`에 Task·Agent·Room Aggregate, 식별자·계보·전달·결과 Value Object, 순수 `InteractionPolicy`, 세 Aggregate별 Repository 계약을 두었다. 식별자·깊이·경로·전달·결과 VO는 각 의미 구조를 기준으로 `equals()`를 제공한다. Task root는 결과 status와 terminal state를 일치시키고 결과와 완료 전이를 한 명령으로 수행한다. 생성·복원 시 task message type, timeout, 생성 시각, 상태, 오류 코드와 root/parent ID·depth의 로컬 일관성도 검증한다. Agent root는 생성·복원·전이 시 허용 상태, offline reason, capability 값의 형식을 검증하며 snapshot validator도 Domain의 상태 판별 함수를 사용한다. Task 요청·결과 metadata는 생성 입력과 조회 결과 사이에서 중첩 복사해 외부 참조가 Aggregate 상태를 바꾸지 못하게 한다. Agent root는 provider/session detail을 소유하지 않으며 Room root는 Agent ID만 보유한다.
- Agent가 현재 상태와 adapter 동시 실행·queue 허용 사실을 함께 보고 새 task 수신 가능 여부를 결정한다. Domain `AgentAggregate.createTask`는 이 판단을 생성 경계에서도 강제하고 Task root를 만든다. Application은 세션·adapter 가용성과 provider capability 사실을 모으고 Domain `AgentTargetSelectionPolicy`가 selector, 방문 경로, Aggregate 상태와 부하에 근거해 후보 적격성과 순위를 결정한다.
- Task Repository와 Infrastructure snapshot-backed 구현을 task 접수·조회·상태 전이·복구 경로에 연결했다. 명령은 root ID로 Aggregate를 불러 저장하고, graph·response/callback 존재 여부·queued Agent 수 query는 목적별 메서드로 제공한다. Recovery는 입력 snapshot에서 복원한 roots를 순회한다. 전체 Task snapshot은 Application의 `A2ATaskSnapshotSource` DTO 계약으로 분리했으며 Domain Repository는 Aggregate collection export를 노출하지 않는다.
- Agent·Room Repository와 snapshot-backed 구현은 runtime 등록·복원·상태 변경·profile 변경·room membership 경로에 연결했다. Aggregate-owned 필드를 snapshot projection에 반영하고 provider/session 필드는 보존한다.
- A2A 방문 경로에서 반복된 agent ID를 거부하던 snapshot 검증을 제거했다. JSON shape 및 task·room·agent 간 참조 검증은 `src/infrastructure/persistence/a2a-runtime-snapshot.ts`에 두고 순서·길이·마지막 대상 및 기존 prefix 검증을 유지한다.
- callback 1회 제한은 원 요청 Task Aggregate의 예약·확정 상태가 소유한다. 복원 시 기존 callback task record에서 확정 상태를 재구성하고, snapshot validator는 callback 원 요청·대상·중복 관계를 검증한다. `TaskFlowPolicy`는 Application이 조회해 전달한 관련 task를 이용해 flow ID·depth를 해석하고, `a2aFlowId`, `a2aFlowDepth`, `delivery`의 값 검증은 Domain Value Object를 사용한다.
- 응답 없이 완료된 A2A 요청을 실패로 처리하는 규칙은 Domain `InteractionPolicy`가 결정한다. Application은 응답 task 존재 여부 조회와 상태·이벤트 적용을 조정한다.
- runtime/admin API, runtime event, runtime projection, 저장소 계약 데이터는 `src/application/dto`의 DTO로 표현한다. `AgentNode`와 `AgentRoom`은 Application runtime projection DTO이며 Domain Aggregate가 아니다. Application mapper가 기존 필드 shape를 보존하면서 projection과 Agent·Room Aggregate 사이를 변환한다. Application mapper는 [`a2a-agent-mapper.ts`](../../src/application/mappers/a2a-agent-mapper.ts)와 [`a2a-collaboration-mapper.ts`](../../src/application/mappers/a2a-collaboration-mapper.ts), public DTO 정의는 [`a2a-collaboration.ts`](../../src/application/dto/a2a-collaboration.ts), snapshot contract는 [`a2a-runtime-snapshot.ts`](../../src/application/dto/a2a-runtime-snapshot.ts)에 있다. DTO 정의 모듈은 Domain 타입을 import하지 않는다.
- Application 안에서 도메인 규칙을 실행할 때 Aggregate와 Value Object를 사용하는 것은 허용하되, Use Case 입·출력과 Application 서비스 간 계약에는 DTO를 쓴다. Provider adapter 실행 요청·결과, Agent history, session tool request와 A2A/A2B 권한 전달은 Application DTO 계약을 사용한다. Task 실행 경로는 `A2ATaskAncestryDto`에 parent/flow-parent ID와 routing facts를 담아 Active Agent resolver·Executor·Router·Scheduler 사이에 전달하고, Aggregate를 사용하는 Use Case가 Repository로 직접 조회한다. 접수·완료·조회·취소 결과는 Task Scheduler·Executor·Queries·Canceller에서 task record DTO로 반환하며 Coordinator와 runtime facade는 DTO를 전달한다. Permission inheritance는 관련 active task의 record DTO를 조회하고 provider adapter에 task·permission DTO를 전달한다. Aggregate 동작 내부에서는 Domain Aggregate/record를 사용하고 취소용 `AbortSignal`은 업무 데이터 DTO와 분리한 실행 제어값으로 전달한다.
- Scheduler에서 Executor로 task Aggregate를 직접 넘기지 않는다. `A2ATaskExecutionRequestDto`는 task ID만 전달하고, 실행 Use Case가 persistence 완료 후 Task Repository에서 Aggregate root를 조회한다. target Agent 정보는 Application projection DTO이며 provider adapter는 구체 실행 의존성으로 전달한다.
- Task lifecycle event와 terminal-result publisher 사이에는 `A2ATaskRecordDto`를 전달한다. Aggregate root는 lifecycle Use Case 내부에서 변경하고 Repository에 저장한 뒤 DTO로 투영해 event와 transcript projection에 전달한다. Result publisher는 root task graph query의 DTO만 읽는다.
- A2A communication summary는 `src/application/dto/a2a-communication.ts`의 `A2ACommunicationSummaryItemDto`를 이벤트·provider turn·transcript cache·daemon wire·Presentation 계약으로 사용한다. group key 생성과 기존 Domain transcript 항목의 복사는 Application mapper가 담당한다. Domain의 동일 구조 타입은 내부 `TranscriptEntry` 표현에만 남겨 외부 계층이 Domain 통신 모델에 직접 의존하지 않도록 한다. 기존 summary 필드, key 생성 규칙과 wire shape는 유지한다.
- `TranscriptEntryDto`는 provider conversation, daemon response, UI bridge, transcript cache 계약에서 공유하는 Application DTO다. cache page, response group과 view도 별도 DTO로 정의한다. Desktop memory/IndexedDB 구현은 DTO를 저장·반환하고 순서 그룹화만 Application mapper가 Domain 규칙에 명시적으로 위임한다. daemon/cache 필드와 paging 순서는 유지한다.
- provider 목록은 `AssistantProviderInfoDto`로 변환해 Application Use Case가 반환한다. prompt image/file attachment와 agent context, workspace 파일 목록·내용·쓰기 결과, provider session identity, 협업 adapter descriptor도 Application DTO로 정의해 provider·daemon·Presentation 경계에서 Domain의 복합 데이터 타입을 직접 전달하지 않는다. 기존 daemon, bridge, 저장 데이터의 필드 구조는 유지한다. Domain validator와 규칙은 경계에서 검증하거나 필요한 사실을 판단하는 용도로 계속 사용한다.
- Snapshot DTO 계약은 Application에 있고 JSON 구조·레코드 간 관계 검증은 Infrastructure에 있다. Task recovery Use Case는 snapshot DTO를 입력으로 받고 Application mapper로 복원용 Domain record를 만든 뒤 Aggregate를 Repository에 적재한다. Domain record를 저장 DTO로 바꾸는 mapper도 Application에 둔다. Agent·Room snapshot은 Repository root 상태를 provider/session detail projection에 반영한다. Snapshot-backed Repository는 변경 root를 기존 전체 snapshot에 기록하며 별도 root별 파일/DB는 사용하지 않는다.
- `A2ARuntimeStatePersistence`가 runtime facade에서 저장 수집·직렬화 책임을 분리한다. Task record DTO는 `A2ATaskSnapshotSource`에서, Agent·Room은 directory projection에서 모아 기존 전체 snapshot DTO로 기록한다. `A2ACollaborationSnapshotStore`는 Repository root write와 전체 snapshot commit을 같은 직렬 queue에 넣고 Infrastructure state store가 JSON 검증과 atomic file write를 수행한다. 기존 저장 계약과 projection을 유지한다.
- A2A/A2B 권한과 전달 제약은 `InteractionPolicy`, Agent 후보 적격성과 우선순위는 `AgentTargetSelectionPolicy`, 흐름 상관관계와 깊이는 `TaskFlowPolicy`가 결정한다. Application은 요청 DTO의 interaction을 `InteractionMode` Value Object로 변환하고, 정책은 검증된 값을 받는다. 정책들은 필요한 외부 사실을 인자로 받아 순수하게 판단한다. 단순 orchestration은 Application에 두며 추가 Domain Service는 한 모델에 둘 수 없는 실제 업무 결정이 확인될 때만 만든다.

## 재방문 규칙의 구현 상태

A2A 흐름은 방문 agent를 다시 거칠 수 있다. snapshot validation은 경로의 순서·길이·마지막 대상 및 기존 parent prefix 검증을 유지하면서 중복 ID만으로 경로를 거부하지 않는다. 반복 방문은 `maxDepth`가 제한한다. 기존 snapshot JSON shape는 바뀌지 않았다.

현재 코드 위치: [`a2a-task-scheduler.ts`](../../src/application/use-cases/a2a-task-scheduler.ts), [`a2a-runtime-snapshot.ts`](../../src/infrastructure/persistence/a2a-runtime-snapshot.ts), [`agent-path` Value Object](../../src/domain/collaboration/value-objects/task-lineage.ts).
