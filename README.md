# Hive 사용 안내

Hive는 Codex, OpenCode, Kiro 코딩 세션을 데스크톱이나 Android 앱에서 이어서 사용하는 도구입니다. Linux 컴퓨터에서 Hive 데몬을 실행하고, 앱을 데몬에 페어링해 사용합니다.

```text
Linux 데몬 컴퓨터 ── 인증된 WSS ── Hive 데스크톱 / Android 앱
       ├── Codex CLI
       ├── OpenCode CLI 또는 기존 OpenCode 서버
       └── Kiro CLI
```

## 다운로드

[Hive 최신 릴리스](https://github.com/inasis/Hive/releases/latest)에서 다음 파일과 각 파일의 `.sha256` 체크섬을 받을 수 있습니다. 파일은 `v*` 태그를 릴리스할 때 자동으로 빌드됩니다.

| 파일 | 용도 | 체크섬 |
| --- | --- | --- |
| [`Hive-linux-x64.tar.gz`](https://github.com/inasis/Hive/releases/latest/download/Hive-linux-x64.tar.gz) | Linux x86_64 데스크톱 앱 설치 파일 | [SHA-256](https://github.com/inasis/Hive/releases/latest/download/Hive-linux-x64.tar.gz.sha256) |
| [`Hive-android-debug.apk`](https://github.com/inasis/Hive/releases/latest/download/Hive-android-debug.apk) | Android 앱 설치 파일 (debug 서명 APK) | [SHA-256](https://github.com/inasis/Hive/releases/latest/download/Hive-android-debug.apk.sha256) |
| [`Hive-daemon-linux-x64.tar.gz`](https://github.com/inasis/Hive/releases/latest/download/Hive-daemon-linux-x64.tar.gz) | Linux x86_64 데몬 실행 파일과 라이선스 고지 | [SHA-256](https://github.com/inasis/Hive/releases/latest/download/Hive-daemon-linux-x64.tar.gz.sha256) |

첫 릴리스 빌드가 완료되기 전에는 다운로드 링크에 파일이 나타나지 않습니다. 게시된 버전과 변경 내용은 [GitHub Releases](https://github.com/inasis/Hive/releases)에서 확인하세요.

## Linux 데스크톱 앱 설치

Linux x86_64에서 아래 명령을 실행합니다. 데스크톱 환경에 따라 GTK 3과 WebKitGTK 4.1 런타임 패키지를 설치해야 할 수 있습니다.

```sh
curl -fLO https://github.com/inasis/Hive/releases/latest/download/Hive-linux-x64.tar.gz
curl -fLO https://github.com/inasis/Hive/releases/latest/download/Hive-linux-x64.tar.gz.sha256
sha256sum -c Hive-linux-x64.tar.gz.sha256
tar -xzf Hive-linux-x64.tar.gz
./installer
```

설치 프로그램은 Hive를 `~/.local/share/`에 설치하고 앱 메뉴에 바로가기를 만듭니다.

## Android 앱 설치

APK와 `.sha256` 파일을 내려받고 체크섬을 확인합니다. APK를 Android 기기로 복사해 열어 설치하거나, USB 디버깅이 켜진 기기에서 `adb`로 설치합니다. 기기에서 외부 앱 설치 허용을 요청할 수 있습니다.

```sh
sha256sum -c Hive-android-debug.apk.sha256
adb install -r Hive-android-debug.apk
```

이 파일은 직접 설치용 debug 서명 APK입니다. Google Play 배포용 서명 APK는 아닙니다.

## Linux 데몬 설치

데몬은 64비트 x86 Linux(glibc)에서 실행됩니다. 데몬 컴퓨터에 Node.js를 설치할 필요는 없습니다. [최신 릴리스](https://github.com/inasis/Hive/releases/latest)에서 `Hive-daemon-linux-x64.tar.gz`와 해당 `.sha256` 파일을 다운로드한 뒤 압축을 풉니다.

```sh
sha256sum -c Hive-daemon-linux-x64.tar.gz.sha256
tar -xzf Hive-daemon-linux-x64.tar.gz
cd Hive-daemon-linux-x64
```

체크섬 확인 결과가 `OK`인지 살펴본 뒤 데몬을 시작합니다.

```sh
./hive daemon
```

데몬은 다음 정보를 터미널에 출력합니다.

- `WSS address`: 앱에 입력할 데몬 주소. 보통 `wss://192.168.x.x:4753/rpc` 형식입니다.
- `Certificate SHA-256`: 서버 인증서를 확인하는 지문입니다.
- `Pairing token`: 앱 연결을 허용하는 비밀 토큰입니다.

터미널을 닫거나 `Ctrl+C`를 누르면 데몬이 종료됩니다. 데몬을 실행하는 동안 터미널을 열어 두세요.

## 데스크톱 또는 Android 앱 연결

1. 데몬 컴퓨터와 클라이언트를 같은 Wi‑Fi 네트워크에 연결합니다.
2. Linux 데스크톱이나 Android 앱에서 데몬 페어링 화면을 엽니다. Windows 데스크톱에서는 **설정 → 연결 → Hive 데몬에 연결**을 선택합니다.
3. 데몬 터미널에 출력된 주소, 인증서 지문, 페어링 토큰을 앱에 입력합니다.
4. 연결 후 사용할 provider를 고르고 세션을 선택하거나 새 세션을 시작합니다.

주소가 여러 개 출력되면 클라이언트와 같은 네트워크 인터페이스의 주소를 사용하세요. 연결되지 않으면 데몬 컴퓨터의 방화벽에서 **TCP 4753**을 허용했는지 확인합니다.

앱은 입력한 SHA-256 지문에 맞는 인증서만 신뢰하고, 페어링 토큰으로 데몬 연결을 인증합니다. 토큰은 비밀번호처럼 취급하고 다른 사람에게 공유하지 마세요. 페어링 정보를 다시 입력하려면 앱에서 **데몬 연결 설정 변경**을 선택합니다.

데몬은 토큰과 인증서 정보를 `~/.config/hive/`에 보관해 다음 실행에도 사용합니다. 토큰을 바꾸려면 데몬을 종료하고 `~/.config/hive/mobile-token`을 삭제한 뒤 다시 시작하세요. 토큰을 바꾸면 클라이언트도 다시 페어링해야 합니다.

## Provider 준비

선택한 provider의 CLI를 데몬 컴퓨터에 설치하고, **데몬을 실행하는 Linux 사용자 계정으로 로그인**하세요. 데몬은 해당 계정의 CLI와 인증 정보를 사용합니다.

### Codex

Codex 세션을 사용할 계정에 Codex CLI를 설치하고 로그인합니다. Linux 데스크톱과 Android는 페어링한 데몬 컴퓨터의 Codex CLI에 연결합니다.

### OpenCode

OpenCode CLI를 설치하고 provider에 로그인합니다. 기본 설정에서 데몬이 `opencode serve`를 시작해 자동 연결합니다. CLI가 `PATH`에 없으면 실행 파일 경로를 지정합니다.

```sh
export HIVE_OPENCODE_BIN="$HOME/.opencode/bin/opencode"
./hive daemon
```

이미 실행 중인 OpenCode 서버를 사용하려면 서버 주소를 설정하세요. Basic 인증을 사용하는 서버는 사용자 이름과 비밀번호도 지정합니다.

```sh
export HIVE_OPENCODE_URL=http://127.0.0.1:4096
export HIVE_OPENCODE_USERNAME=opencode
export HIVE_OPENCODE_PASSWORD='서버 비밀번호'
./hive daemon
```

환경 변수를 바꾼 뒤에는 데몬을 다시 시작해야 적용됩니다.

### Pi

Pi CLI를 설치합니다. Hive에서 Pi를 선택하면 로컬 Pi의 RPC 세션을 사용합니다. Hive 모델 목록과 기본 모델은 Pi RPC가 반환한 사용 가능한 모델을 따릅니다. `~/.pi/agent/models.json`에 Pi에서 사용할 provider와 모델을 설정하세요. API 키는 파일에 직접 넣거나 Pi 프로세스가 읽을 수 있는 환경 변수 이름으로 지정할 수 있습니다.

```json
{
  "providers": {
    "hive": {
      "baseUrl": "http://127.0.0.1:9000/v1",
      "apiKey": "HIVE_PI_API_KEY",
      "api": "openai-completions",
      "models": [{
        "id": "gemma-4-12b",
        "name": "gemma-4-12b",
        "reasoning": false,
        "input": ["text"],
        "contextWindow": 131072,
        "maxTokens": 8192,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
        "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false }
      }]
    }
  }
}
```

`apiKey` 예시의 `HIVE_PI_API_KEY`는 Pi가 찾을 환경 변수 이름입니다. 민감한 키를 리터럴로 저장할 때는 설정 파일을 소유자만 읽을 수 있게 제한하세요. Pi가 `PATH`에 없으면 `HIVE_PI_BIN`에 실행 파일 경로를 지정합니다. Pi provider는 Hive host의 로컬 작업공간에서 실행되며 SSH 작업공간은 지원하지 않습니다.

Pi 모델이 RPC에서 광고하는 Thinking 수준은 세션 설정에 표시됩니다. 모델의 `input`에 `image`가 있으면 이미지 프롬프트도 보낼 수 있습니다. Pi 전용 `/compact`, `/stats`, `/export`, `/bash`, `/follow_up`, `/clear_queue`, `/steering_mode`, `/follow_up_mode`, `/auto_compaction`, `/auto_retry`, `/abort_retry`, `/abort_bash` 명령은 Pi RPC를 직접 호출합니다. `/bash`는 작업공간에서 셸 명령을 즉시 실행합니다. Pi RPC에는 Codex 방식의 Hive 권한 프로필과 도구 승인 요청이 없으므로, 도구 권한은 Pi 자체 설정을 따릅니다.

### Kiro

Kiro CLI를 설치하고 로그인합니다. `kiro-cli`가 `PATH`에 없다면 실행 파일 경로를 지정한 뒤 데몬을 시작합니다.

```sh
export HIVE_KIRO_BIN="$HOME/.local/bin/kiro-cli"
./hive daemon
```

## 다른 네트워크에서 연결

먼저 VPN으로 데몬 컴퓨터와 클라이언트를 같은 사설 네트워크에 연결하는 방법을 권장합니다. 공인 IP로 직접 연결하려면 라우터에서 TCP 4753을 데몬 컴퓨터로 전달하고 방화벽에서도 허용한 뒤, 실제 공인 IP를 데몬에 지정합니다.

```sh
./hive daemon --public-url wss://<공인-IP>:4753/rpc
```

앱에는 데몬이 출력한 주소와 인증서 지문, 토큰을 입력합니다. `<공인-IP>`를 실제 주소로 바꾸세요. ISP의 CGNAT 환경에서는 포트 전달이 동작하지 않을 수 있습니다.

## 문제 해결

- **실행 파일이 시작되지 않음:** 이 릴리스는 64비트 x86 Linux(glibc)를 대상으로 합니다. `uname -m`이 `x86_64`인지 확인하세요.
- **앱에서 연결할 수 없음:** 데몬과 클라이언트가 서로 접근 가능한 네트워크에 있는지, TCP 4753이 방화벽에서 허용됐는지 확인하세요. 여러 주소가 출력되면 올바른 네트워크 인터페이스의 주소를 사용하세요.
- **인증서 또는 토큰 오류:** 데몬이 현재 출력한 지문과 토큰을 다시 입력하세요. 데몬 인증서나 토큰을 삭제 또는 교체했다면 클라이언트에서 저장된 페어링을 지우고 다시 연결해야 합니다.
- **provider를 찾을 수 없음:** 선택한 CLI가 설치되어 있고 데몬을 실행한 사용자에게 `PATH`로 보이는지 확인하세요. 필요하면 위 환경 변수로 실행 파일 경로를 지정하고 데몬을 재시작하세요.

## 라이선스

Hive는 BSD-2-Clause 라이선스로 배포됩니다. 데몬 배포 파일에는 Hive와 포함된 구성 요소의 라이선스 고지도 들어 있습니다. 자세한 내용은 [LICENSE](./LICENSE)를 참고하세요.
