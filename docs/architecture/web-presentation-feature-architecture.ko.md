# Web 렌더러 기능 중심 소스 및 번들 정리 계획

이 문서는 `apps/web/dist/assets`에서 관찰되는 JavaScript 번들을 `src/presentation`의 기능 경계에 맞춰 정리하기 위한 기준과 단계다. 계층 의존성, 공용 Presentation 책임, 동작·호환성 제한은 [`refactoring-goals.ko.md`](./refactoring-goals.ko.md)와 [`llm-coding-constraints.ko.md`](./llm-coding-constraints.ko.md)를 따른다.

## 범위와 기본 전제

- `apps/web`은 공유 renderer의 Vite 진입점과 빌드 설정을 소유한다. 공용 UI 구현은 `src/presentation`에 있고, 데스크톱 platform 구현은 `apps/desktop/src/platform`에 있다.
- Vite가 생성하는 `apps/web/dist`는 `.gitignore` 대상 산출물이다. Electrobun과 Capacitor Android가 이 디렉터리를 소비한다.
- 해시가 붙은 asset 파일은 import graph와 빌드 최적화의 결과다. 산출물을 직접 이동·수정하거나 파일명을 기능 디렉터리처럼 관리하지 않는다. 기능 중심 정리는 소스 모듈과 동적 import 경계에서 수행한다.
- `apps/web/src`에 Presentation 구현을 복제하지 않는다. 이 디렉터리는 renderer 진입점과 앱 조립을 유지한다.

## 현재 산출물 관찰

아래 크기는 현재 작업 트리의 `apps/web/dist/assets` 파일에서 읽은 바이트 수다. 파일명 해시는 매 빌드마다 달라질 수 있으므로 기준 식별자로 사용하지 않는다.

| 산출물 패턴 | 크기 | 소스 기능 및 확인된 경계 |
| --- | ---: | --- |
| `index-*.js` | 567,563 B | `apps/web/src/main.tsx`에서 시작하는 기본 진입 번들. 설정·세션·페르소나 화면은 `WorkspacePageContent`에서 선택된 화면만 지연 import한다. |
| `ConversationWorkspace-*.js` | 196,505 B | 세션 화면을 표시할 때 `WorkspacePageContent`가 지연 import한다. 세션 화면에서는 진입 번들과 함께 로드된다. |
| `TerminalPanel-*.js` | 336,983 B | `src/presentation/composition/workspace-conversation-presentation.tsx`의 지연 import 대상. `features/workspace/TerminalPanel.tsx`와 xterm 의존성이 포함된다. |
| `WorkspaceMotion-*.js` | 76,470 B | `features/workspace/WorkspaceFrame.tsx`가 지연 로드하는 workspace 전환 효과 모듈이다. |
| `FileDocument-*.js` | 9,130 B | `features/conversation/ConversationWorkspace.tsx`에서 파일 미리보기 사용 시 지연 로드한다. |
| `mermaid.core-*.js` | 697,070 B | `shared/MermaidMarkdown.tsx`에서 Mermaid를 동적으로 불러오는 경로에 속한다. diagram definition, layout, renderer 관련 asset도 별도 청크로 생성된다. |
| `pdf-*.js`, `pdf.worker*.mjs` | 479,344 B, 1,262,398 B | `features/conversation/file-content-extractor.ts`의 PDF 추출 경로와 전용 worker 산출물이다. |
| `docx-text-extractor.worker-*.js` | 311,471 B | `features/conversation/docx-text-extractor.worker.ts`의 DOCX 텍스트 추출 worker다. |
| `katex-*.js`, `cytoscape.esm-*.js` 등 | 각 261,329 B, 443,834 B 외 | Hive 소스 모듈이 아닌 라이브러리 산출물이다. 실제 importer와 eager/lazy 여부는 번들 graph에서 추적한 뒤 경계를 바꾼다. |

이 목록은 빌드 결과에서 확인할 수 있는 경계만 설명한다. 청크 크기만으로 소스 책임이나 화면 사용 시점을 단정하지 않고, 이후 변경 때는 소스 import graph와 빌드 출력을 함께 확인한다.

2026-10-09 빌드에서는 설정, 스킬, 페르소나, 역할 공간, 세션 화면을 선택 시점에 지연 import하도록 바꿨다. 진입 번들은 786,024 B에서 567,563 B로, gzip 기준 226,267 B에서 161,660 B로 줄었다. 세션 화면을 초기 페이지로 여는 경우 `ConversationWorkspace` 196,505 B도 바로 로드되므로 첫 화면 전체는 약 764,068 B이며, 변경 전보다 약 22 kB 감소했다. 설정 화면으로 시작하면 연결 설정 청크를 합쳐 약 570,633 B를 로드한다. `dist` 총량은 6,799,158 B로 거의 변하지 않았다. 이 변경은 시작 경로에서 즉시 전송하는 코드를 줄였으며 전체 설치 산출물 용량을 줄인 것은 아니다.

## 기능별 소스 책임

| 기능 경계 | 소유할 소스 | 경계 원칙 |
| --- | --- | --- |
| Renderer 진입·화면 조립 | `apps/web/src/main.tsx`, `src/presentation/App.tsx`, `src/presentation/composition` | 플랫폼 runtime과 화면 feature를 연결한다. provider 프로토콜, daemon wire 처리, 파일 저장 구현을 이곳에 추가하지 않는다. |
| 연결 | `src/presentation/features/connection` | 연결 화면 상태와 사용자 흐름을 표현한다. transport 연결·재연결 구현은 platform 경계에 둔다. |
| 대화 | `src/presentation/features/conversation` | composer, transcript, 첨부 파일 선택과 미리보기·텍스트 추출 진입을 소유한다. 대용량 문서 parser와 worker는 사용 흐름에서 지연 로드한다. |
| 세션 | `src/presentation/features/sessions` | 세션 생성·열기·삭제·이름 변경 및 대화 탭 관련 UI 흐름을 소유한다. |
| workspace | `src/presentation/features/workspace` | sidebar, 파일·terminal panel, 탭, 레이아웃과 전환 효과를 소유한다. Terminal과 사용 빈도가 낮은 motion은 기존 사용자 동작을 유지하며 필요 시점에 불러온다. |
| 설정·skills·창 | `src/presentation/features/settings`, `features/skills`, `features/window` | 각 화면 기능의 컴포넌트와 상태를 소유한다. 다른 feature가 직접 내부 모듈을 참조하지 않게 한다. |
| 공용 Presentation | `src/presentation/shared` | 둘 이상의 feature가 공유하는 표시 컴포넌트, 타입, 계약만 둔다. 특정 기능 모듈을 단지 청크를 쪼개기 위해 `shared`로 옮기지 않는다. |
| 플랫폼 구현 | `apps/desktop/src/platform` | 브라우저·Electrobun·IndexedDB 등 renderer 플랫폼 기능을 소유한다. 공용 Presentation은 기존 typed 계약을 통해 사용한다. |

feature 사이 조립은 `src/presentation/composition`에서 한다. 공유 대상이 아닌 feature 구현끼리 직접 import하지 말고 필요한 화면 계약을 명시해 조립 경계에서 전달한다.

## 번들 경계 원칙

1. **소스 소유권을 먼저 정한다.** 컴포넌트, 상태, 전용 helper, worker는 실제 기능이 소유한다. import된 외부 라이브러리 산출물은 별도 제품 feature로 재분류하지 않는다.
2. **사용자 흐름에 맞춰 지연 로드한다.** 시작 화면에 필요하지 않은 큰 panel, 미리보기, 다이어그램 및 추출 기능은 해당 상호작용 진입점에서 동적 import한다. 현재 있는 terminal, motion, 파일 미리보기, PDF 및 Mermaid의 지연 경계를 임의로 eager import로 바꾸지 않는다.
3. **기본 번들의 책임을 좁힌다.** `index-*.js`에는 앱 시작과 기본 화면에 필요한 의존성만 남기는 방향으로 개선한다. 청크를 잘게 나누는 것 자체를 목표로 삼지 않고, 실행 시점과 기능 책임이 분명한 경계만 추가한다.
4. **worker를 실행 경계로 유지한다.** PDF·DOCX 추출 worker를 기본 UI 실행 그래프에 합치지 않는다. worker 생성 방식, URL, 메시지 형식과 오류 처리는 별도 변경 없이 유지한다.
5. **자동 청크 분할을 우선한다.** 기능 단위 동적 import와 기존 Vite/Rollup 분할을 먼저 활용한다. `manualChunks`는 측정 결과상 자동 분할로 해결되지 않는 의존 중복이나 시작 비용이 확인된 경우에만 검토하고, 특정 해시 파일명에 의존하지 않는다.
6. **해시 산출물은 빌드가 관리한다.** 출력 파일의 수·이름·크기는 소스와 dependency 변화에 따라 달라질 수 있다. 손으로 이름을 고정하거나 `dist` 파일을 커밋하지 않는다.

## 단계별 적용 순서

1. 빌드 산출물 이름을 소스 모듈에 대응시키고, 정적·동적 import 및 worker 경계를 기록한다. 이 문서의 산출물 표는 첫 기준선이며 이후에는 실제 빌드 결과에 맞춰 갱신한다.
2. 책임이 기능 폴더 밖에 섞여 있는 경우, 호출 경로와 feature 간 소비자를 먼저 추적한다. 한 번에 기능 책임 하나만 옮기고 `src/presentation`의 기존 연결·대화·세션·설정·workspace 구분을 기준으로 한다.
3. 무거운 기능 의존성은 해당 기능 진입점에서만 로드되도록 동적 import 위치를 정리한다. 사용자 상호작용, fallback, 취소 및 오류 표시 순서를 보존한다.
4. `index-*.js`와 기능 청크 크기, worker 산출물 및 빌드 경고를 비교한다. 실제로 시작 비용이나 중복이 줄지 않았다면 청크 구성만을 위한 추가 계층을 만들지 않는다.
5. 공용 renderer 산출물이 데스크톱과 Android에서 계속 공유되는지 확인한다. 앱별 차이는 platform integration과 기존 typed contract에 둔다.

## 변경 불가 조건과 완료 기준

- 화면·provider 동작, daemon API와 bridge wire shape, 연결·인증·저장 의미를 이 번들 정리만으로 바꾸지 않는다.
- 새 UI 설계, 새 패키지 도입, `dist` 파일 직접 편집, feature마다 파일을 무조건 하나의 번들로 만드는 작업은 범위에 포함하지 않는다.
- feature가 가진 기능 코드와 전용 의존성이 해당 feature 진입점에서 추적 가능하고, 공용 모듈은 실제 공유 책임만 가져야 한다.
- 시작 시 불필요한 기능 의존성이 기본 번들에서 분리되더라도 해당 기능의 기존 사용자 흐름은 그대로 동작해야 한다.
- 데스크톱과 Android가 같은 `apps/web/dist` 산출물을 계속 소비하고, 현재 workspace build 명령으로 산출물이 생성되어야 한다.
- 향후 코드 변경의 빌드 검증은 저장소의 기존 명령인 `npm run build:app`을 기준으로 한다. 빌드 성공만으로 화면 상호작용이나 기기 동작을 확인했다고 간주하지 않는다.
