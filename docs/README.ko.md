# Hive 사용 안내

Hive는 Electrobun 데스크톱 앱과 Android 앱에서 Codex 세션을 연결합니다. Linux 데스크톱과 Android는 기본으로 WSS를 통해 Hive 데몬에 페어링하며, 데스크톱은 SSH나 Hive TCP 릴레이 직접 연결도 지원합니다.

개발 및 코드 변경 시 적용할 LLM 에이전트 제한사항은 [코드 작성 지침](./architecture/llm-coding-constraints.ko.md)을 참고하세요.

## 설치 및 실행

```sh
npm ci
npm run desktop:dev
```

Linux에서는 시작 화면에 데몬 WSS 주소, 인증서 지문, 페어링 토큰을 입력합니다. SSH/릴레이 직접 연결을 선택하면 연결 설정에서 `user@host` 또는 SSH config 별칭을 입력할 수 있습니다. 원격 호스트에 Codex CLI가 설치되어 있고 SSH 비대화형 셸에서 `codex`를 찾을 수 있어야 합니다. 릴레이를 쓰려면 [CLI 및 데스크톱 안내](./codex-bridge.md#connect-through-the-tcp-relay)를 참고하세요.

Windows x64 데스크톱 패키지는 Windows에서 Node.js 20 이상과 npm을 설치하고 저장소 루트에서 `npm ci` 및 `npm run desktop:build`를 실행해 빌드합니다. `.exe`와 설치 패키지는 `apps/desktop/artifacts/`에 생성됩니다. Linux에서는 Windows 실행 파일을 교차 빌드할 수 없습니다. GitHub Actions의 **Electrobun Windows build** 실행 결과에서 `Hive-windows-x64` 아티팩트를 받을 수도 있습니다.

세션을 열면 대화, 터미널, 파일 탭이 표시됩니다. 파일 탐색은 읽기 전용이며 UTF-8 텍스트 파일을 최대 1 MiB까지 미리 봅니다.

## Android 빌드

Node.js 20 이상, Java 21, Android SDK platform 35 및 Build Tools 35.0.0이 필요합니다.

```sh
npm ci
npm run android:build
```

APK는 `artifacts/android/Hive-android-debug.apk`에 생성됩니다. Android Studio 프로젝트는 `apps/android/android`입니다.

## Linux 데스크톱과 Android IP 연결

도메인과 수동 TLS 인증서 없이 사용할 수 있습니다. 휴대폰과 데몬을 실행할 컴퓨터를 같은 Wi‑Fi에 연결하고 Codex 호스트에서 다음 명령을 실행합니다.

```sh
npm ci
npm run daemon
```

`npm run daemon`은 데몬을 빌드하고 시작합니다. 이 명령을 다시 실행하면 같은 명령으로 관리하는 데몬을 기존 CLI 인자와 환경으로 재시작합니다. 연결된 클라이언트는 prompt 제출 중 데몬 연결이 끊기면 동일 요청을 메모리에 보관했다가 provider 복구 뒤 한 번 재전송합니다. 해당 thread의 turn 시작 이벤트를 이미 받은 경우에는 재전송하지 않으며 prompt를 디스크에 쓰지 않습니다. 데몬이 `wss://192.168.x.x:4753/rpc` 형태의 주소, 인증서 SHA-256 지문, 페어링 토큰을 출력합니다. Linux 데스크톱이나 Android 연결 화면에서 세 값을 한 번 입력하고, 컴퓨터 방화벽에서 TCP 4753을 허용합니다. 주소가 여러 개라면 괄호 안 네트워크 인터페이스 이름을 보고 클라이언트와 같은 Wi‑Fi 주소를 선택하세요. 인증서와 토큰은 `~/.config/hive/`에 저장됩니다. 데몬을 종료하려면 터미널에서 `Ctrl+C`를 누르세요.

외부 네트워크에서도 공인 IP로 연결하려면 라우터에서 TCP 4753을 데몬 컴퓨터의 LAN IP와 포트 4753으로 전달하고, 호스트 방화벽에서 포트를 허용하세요. 공인 주소를 출력하려면 다음 명령에서 예시 IP를 실제 공인 IP로 바꿉니다.

```sh
npm run daemon -- --public-url wss://203.0.113.10:4753/rpc
```

클라이언트에 출력된 공인 WSS 주소를 입력하세요. 통신사 CGNAT에서는 포트 전달이 되지 않을 수 있어 VPN 연결이 필요합니다.

페어링 후 앱은 데몬 컴퓨터의 로컬 Codex CLI에 직접 연결합니다. SSH 대상이나 릴레이 URI를 한 번 더 입력하지 않습니다. Codex는 데몬을 실행한 사용자 계정에 설치되고 로그인되어 있어야 합니다. 데몬 컴퓨터가 켜져 있어야 하며, 기본 연결은 같은 LAN 안에서 동작합니다. 집 밖에서 연결하려면 VPN이나 외부에서 접근 가능한 IP와 방화벽 설정이 필요합니다. 연결 설정 변경을 누르면 저장한 주소, 지문, 토큰을 지우고 다시 페어링합니다.

## CLI

```sh
npm ci
npm run build
node dist/cli.js --help
```

세션 목록, 대화 이력 보관, 이어서 실행은 [CLI 안내](./codex-bridge.md)를 참고하세요.

## 라이선스

저장소 라이선스는 [BSD-2-Clause](../LICENSE)입니다.
