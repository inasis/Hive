# 저장소 코드 작성 지침

이 저장소를 수정하는 코딩 에이전트는 작업 전에 [`docs/architecture/llm-coding-constraints.ko.md`](docs/architecture/llm-coding-constraints.ko.md)를 읽고 따라야 한다. 아키텍처 변경은 [`docs/architecture/refactoring-goals.ko.md`](docs/architecture/refactoring-goals.ko.md)의 계층 원칙과 동작·보안·호환성 제한을 따른다.

- 먼저 `git status`와 관련 diff를 확인하고 기존 변경을 보존한다. 확인 없이 `reset`, `checkout`, `clean`, stash 적용·제거 등 작업을 되돌리는 명령을 실행하지 않는다.
- 사용자 요청의 범위를 임의로 넓히거나 동작·UI를 바꾸지 않는다. 모호하면 안전한 범위에서 독립적으로 진행하고, 사용자 결정이 꼭 필요한 경우에만 질문한다.
- provider, daemon wire protocol, 저장 데이터, 인증, 연결 보안 동작을 변경하기 전에는 관련 계약과 기존 소비자를 확인한다.
- 변경한 코드와 실제 실행한 빌드·검증만 보고한다. 실행하지 않은 UI, 기기, provider, 플랫폼 동작을 확인했다고 표현하지 않는다.

