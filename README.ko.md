# Hive

Hive는 AI 코딩 provider의 세션을 찾아 이어가는 Electrobun 데스크톱 앱과 Android 앱입니다. Codex app-server, OpenCode HTTP server, Kiro CLI를 지원합니다. Linux 데스크톱과 Android는 기본으로 인증된 WSS를 통해 Hive 데몬에 연결하고, 데스크톱 앱은 SSH나 Hive TCP 릴레이로 직접 연결하는 방식도 지원합니다.

```text
Linux 데스크톱 / Android (공유 React 화면) ─ WSS ── Hive 데몬
                                                ├── Codex app-server
                                                ├── OpenCode HTTP API
                                                ├── Kiro CLI / ACP
                                                └── SSH / Hive TCP 릴레이 ── 작업공간 host
```

## 구조

- `apps/desktop`: Electrobun 호스트 프로세스와 React/Vite UI
- `apps/android`: 같은 UI를 사용하는 Capacitor Android 앱
- `src`: WSS 데몬, provider 어댑터(Codex/OpenCode/Kiro), SSH/TCP 릴레이 전송, 터미널·파일 도구, CLI

Electrobun은 Linux, Windows, macOS 데스크톱을 빌드합니다. Linux 데스크톱과 Android는 기본으로 데몬 페어링 화면을 엽니다. Linux에서는 SSH/릴레이 직접 연결로 전환할 수도 있습니다. Android 휴대폰은 Hive 데몬에 연결하며 SSH나 Codex를 직접 실행하지 않습니다.

데몬 WSS API의 `listProviders` 요청은 provider별 기능 목록을 돌려줍니다. provider별 요청에는 provider ID를 보낼 수 있습니다. 이전 클라이언트가 ID를 생략하면 Codex를 사용하고, 지원하지 않는 ID는 오류로 거부합니다. `connect`는 선택한 provider의 모델 목록을 돌려주며, 열린 세션의 모델은 `updateThreadSettings`로 바꿉니다.

## 데스크톱 개발

Node.js 20 이상과 npm이 필요합니다.

```sh
npm ci --prefix apps/desktop
npm run desktop:dev
```

`npm run desktop:build`로 데스크톱 패키지를 빌드합니다. Linux에서는 GTK 3와 WebKitGTK 4.1 개발 라이브러리도 필요합니다. Linux 앱은 먼저 데몬 주소와 인증 정보를 입력하는 화면을 엽니다. SSH나 릴레이를 직접 쓰려면 **SSH 또는 릴레이로 직접 연결**을 선택하세요.

## Android 빌드

Node.js 20 이상, Java 17 이상, Android SDK platform 35와 Build Tools 35.0.0이 필요합니다.

```sh
./scripts/build-android.sh
```

스크립트가 React 화면을 빌드하고 Capacitor Android 프로젝트에 복사한 뒤, 디버그 APK를 `artifacts/android/Hive-android-debug.apk`에 둡니다. Android Studio에서 `apps/android/android`를 열어 기기에서 실행하거나 릴리스 서명을 설정할 수 있습니다.

## Linux 데스크톱과 Android를 IP 주소로 데몬에 연결

도메인이나 TLS 인증서를 준비할 필요가 없습니다. Android와 Hive 데몬을 실행할 컴퓨터를 같은 Wi‑Fi에 연결한 뒤, Codex 호스트에서 데몬을 시작합니다.

```sh
npm ci
npm run daemon
```

`npm run daemon`이 데몬을 빌드한 뒤 바로 실행합니다. 데몬이 `wss://192.168.x.x:4753/rpc` 같은 LAN 주소, 인증서 SHA-256 지문, 페어링 토큰을 출력합니다. Linux 데스크톱이나 Android 연결 화면에 세 값을 한 번 입력하면 됩니다. 주소가 여러 개 나오면 괄호에 표시된 네트워크 인터페이스를 보고 클라이언트와 같은 Wi‑Fi 주소를 고르세요. 컴퓨터 방화벽에서 TCP 4753 연결도 허용해야 합니다. 앱은 입력한 지문과 일치하는 데몬 인증서에만 연결합니다. 데몬이 인증서와 토큰을 `~/.config/hive/`에 저장하므로 다음 실행에서도 페어링 정보를 재사용할 수 있습니다. 데몬을 종료하려면 터미널에서 `Ctrl+C`를 누르세요.

집 밖에서도 공인 IP로 접속하려면 라우터에서 TCP 4753을 데몬 컴퓨터의 LAN IP(예: `192.168.0.5`)와 같은 포트 4753으로 포트 전달하고, 컴퓨터 방화벽에서도 허용하세요. 공인 IP 주소를 데몬 출력에 표시하려면 다음처럼 실행합니다.

```sh
npm run daemon -- --public-url wss://203.0.113.10:4753/rpc
```

예시 IP를 실제 공인 IP로 바꾸고, 클라이언트에도 출력된 `wss://공인-IP:4753/rpc` 주소를 입력하세요. ISP의 CGNAT 환경에서는 포트 전달이 동작하지 않을 수 있으므로 VPN을 사용해야 합니다.

페어링이 끝나면 앱이 데몬 컴퓨터의 로컬 Codex CLI에 바로 연결해 세션을 불러옵니다. SSH 대상이나 릴레이 URI를 다시 입력할 필요가 없습니다. 데몬을 실행한 사용자 계정에 Codex CLI가 설치되고 로그인되어 있어야 합니다. 데몬 컴퓨터가 켜져 있고 클라이언트에서 접근 가능해야 하며, 외부에서 연결하려면 VPN 또는 외부 IP와 방화벽 설정이 필요합니다.

Linux 데스크톱과 Android 앱은 데몬 주소, 지문, 토큰을 앱 로컬 저장소에 보관합니다. **데몬 연결 설정 변경**을 누르면 저장된 페어링을 지웁니다. 토큰을 회전하려면 데몬을 중지하고 `~/.config/hive/mobile-token`을 삭제한 뒤 다시 시작하세요.

## OpenCode 연결

연결 설정에서 **OpenCode** provider를 고릅니다. Hive 데몬은 시작할 때 설치된 `opencode` CLI로 `opencode serve --hostname 127.0.0.1 --port 4096`을 실행하고, CLI가 출력한 서버 비밀번호를 읽어 자동 연결합니다. 비밀번호는 메모리에서만 사용하며 앱에 입력할 필요가 없습니다. 데몬을 실행하는 사용자 계정에 OpenCode CLI와 provider 로그인 정보가 있어야 합니다.

```sh
# PATH에서 opencode를 찾을 수 없는 경우 CLI 경로를 지정
export HIVE_OPENCODE_BIN="$HOME/.opencode/bin/opencode"
npm run daemon
```

기존 OpenCode 서버에 연결하려면 `HIVE_OPENCODE_URL`을 설정합니다. 이 경우 Hive가 새 서버를 실행하지 않으며, Basic 인증을 쓰는 서버는 사용자 이름과 비밀번호도 지정해야 합니다. 환경 변수 변경은 데몬을 다시 시작한 뒤 적용됩니다.

```sh
export HIVE_OPENCODE_URL=http://opencode-host:4096
export HIVE_OPENCODE_USERNAME=opencode
export HIVE_OPENCODE_PASSWORD='기존 서버 비밀번호'
npm run daemon
```

`HIVE_OPENCODE_URL`을 생략하면 데몬이 기본 주소의 서버를 직접 실행합니다. `HIVE_OPENCODE_USERNAME`/`HIVE_OPENCODE_PASSWORD` 또는 OpenCode의 `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`로 고정 인증 정보를 지정할 수도 있습니다. Android와 데몬 연결 클라이언트에서는 OpenCode와 작업공간이 데몬 host에서 실행됩니다. OpenCode provider API 키와 모델 설정은 OpenCode가 관리합니다.

## Kiro 연결

연결 설정에서 **Kiro** provider를 선택하세요. Hive 데몬을 실행하는 host에 Kiro CLI를 설치하고 로그인해야 합니다. Hive는 `kiro-cli acp`로 대화 세션을 열고, Kiro CLI 명령으로 세션 목록을 불러오거나 삭제합니다. 데몬 host 로컬과 SSH host를 지원하며 TCP 릴레이는 지원하지 않습니다. 로컬 CLI가 PATH에 없다면 Hive 시작 전에 `HIVE_KIRO_BIN`에 실행 파일 경로를 지정하세요. SSH host에서는 비대화형 셸의 PATH에서 `kiro-cli`를 찾을 수 있어야 합니다.

Kiro 세션에서는 모델과 Thinking 수준, 에이전트 모드를 바꿀 수 있고 Kiro 도구의 승인 요청을 처리합니다. 새 세션을 만들 때 Kiro 권한 프리셋을 고를 수 있으며, 프리셋은 세션의 허용 규칙을 추가합니다. Kiro ACP가 요청하는 파일 읽기·쓰기와 명령 터미널도 Hive가 작업공간 범위에서 제공합니다. 세션 이름은 Hive 목록 별칭으로 저장됩니다. Kiro의 스킬과 ACP 슬래시 명령도 사용할 수 있고, 이미지 파일을 첨부하거나 붙여넣을 수 있습니다. 완료된 응답에서 포크하거나 `/rewind <번호>`로 이전 프롬프트에서 새 세션을 만들 수 있습니다. 공개 ACP 문서에는 Hive가 연결할 실시간 steer 요청 형식이 정의되어 있지 않습니다.

## CLI

```sh
npm ci
npm run build
node dist/cli.js --help
```

릴레이 설정, 세션 조회, 대화 기록 보관, 이어서 실행하는 방법은 [CLI 및 데스크톱 안내](./docs/codex-bridge.md)를 참고하세요.

## 라이선스

Hive 소스는 BSD-2-Clause를 따릅니다. [LICENSE](./LICENSE)를 참고하세요. Electrobun, Capacitor 및 각 의존성은 자체 라이선스를 따릅니다.
