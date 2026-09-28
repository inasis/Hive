# Hive CLI, Electrobun Desktop, and Android Client

[한국어 사용 안내](./README.ko.md)

TypeScript CLI and Electrobun desktop app for discovering, archiving, and interactively resuming Codex CLI sessions. The Linux desktop and Android clients use a Hive daemon over pinned WSS by default; desktop apps can also connect directly over SSH or a TCP relay. In relay mode, a Hive host agent runs Codex's local app-server and the desktop app connects to its stream through a relay. It does not embed Paseo code.

## Requirements

- Node.js 20 or newer
- SSH access to the source computer for SSH mode
- Codex CLI installed and authenticated on the Codex host
- Bash available on the source computer for SSH terminal sessions, and Python 3 for the SSH Files view; relay agents use the host's local PTY and filesystem

## Build

```sh
npm install
npm run build
node dist/cli.js --help
```

The Electrobun desktop app, based on PiBun's main workspace layout, is built as a separate app:

```sh
npm install --prefix apps/desktop
npm run build:app        # Build the React screen
npm run desktop:build    # Package the Electrobun desktop app
npm run desktop:dev      # Launch the desktop app
npm run dev:app          # Start the browser preview server
```

Build the Windows x64 executable and installer on Windows with Node.js 20 or newer:

```powershell
npm ci --prefix apps/desktop
npm run desktop:build
```

The package is written to `apps/desktop/artifacts/`. Electrobun builds for the host OS, so use a Windows machine or download the `Hive-windows-x64` artifact from the **Electrobun Windows build** GitHub Actions run.

The main screen is independently implemented using the workspace and conversation layout in [PiBun](https://github.com/khairold/pibun) as a reference. The desktop app separates Sessions, Skills, and Connection Settings into distinct pages. On Linux it starts with daemon pairing; choose **SSH 또는 릴레이로 직접 연결** to use the direct SSH or relay workflow instead. On Windows and macOS, open Connection Settings and enter an SSH target or a Hive relay URI. Select an existing thread to resume it, or use the `+` beside a workspace to create a new Codex session in that remote directory. The new-session dialog also accepts another remote path. Model and Thinking selectors update the active Codex thread through app-server and apply to the next turn.

The workspace has three views: **Chat**, **Terminal**, and **Files**. Terminal starts an interactive PTY in the active workspace over SSH, or asks the relay host agent to open a PTY on the remote computer. Files lists directories and previews UTF-8 text files through SSH or the relay. File access is read-only, stays inside the active workspace, and previews are limited to 1 MiB per file.

`npm run dev:app` builds a browser UI preview; live SSH and relay app-server RPC are provided by the native Electrobun host.

The app composer supports `/skills`, `/skill:<name>`, `/resume <thread-id>`, `/help`, and `/quit`. When the Codex app-server exposes its native Goal API, `/goal` shows the current session goal, `/goal pause` pauses it, `/goal resume` marks it active, `/goal <objective>` sets it, and `/goal clear` removes it. To resume a goal in a saved session, open that Codex thread and enter `/goal resume`; this reactivates the goal status but does not start a new turn, so send the next prompt afterward. This Goal command is Codex-only and is hidden when the connected app-server does not provide the Goal API. Codex TUI-only screen commands are not executed by app-server. A thread already being used by another Codex client must be closed there before Hive can resume it.

## Android client and Linux daemon connection

The Capacitor Android app packages the same React UI as the Electrobun desktop app. Android and Linux daemon mode do not start SSH or Codex on the client. They send the existing UI RPC calls to the Hive daemon, which uses its local Codex login, terminal, and workspace access.

Build the debug APK with Node.js 20+, Java 17+, and Android SDK platform 35 / Build Tools 35.0.0:

```sh
./scripts/build-android.sh
```

The build stages `artifacts/android/Hive-android-debug.apk`. Open `apps/android/android` in Android Studio to run it on a device or configure release signing.

Connect the Linux desktop or Android device and Codex host to the same Wi-Fi, then build and start the daemon with one command. No domain or manually supplied TLS certificate is needed:

```sh
npm run daemon
```

The daemon prints one or more LAN WSS addresses, a certificate SHA-256 fingerprint, and a pairing token. If there are multiple addresses, use the network interface label in parentheses to choose the client's Wi-Fi network. Enter that address, the fingerprint, and the token in the Linux desktop or Android pairing screen once. Allow TCP port 4753 through the computer's firewall. The daemon generates and persists its certificate and token under `~/.config/hive/`. After pairing, the client talks to the local Codex CLI on the daemon host directly, so it needs no second SSH target or relay URI. Codex must be installed and signed in as the user running the daemon. Keep the token private because it grants access to the host's Codex sessions, terminal, and workspace files. Stop the daemon with Ctrl+C.

For a public IP, forward TCP port 4753 on the router to port 4753 on the daemon host, allow it through the host firewall, and advertise it with:

```sh
npm run daemon -- --public-url wss://203.0.113.10:4753/rpc
```

Replace the example IP with the host's public IP. Use the printed public WSS address in the client. Carrier-grade NAT blocks unsolicited inbound port forwarding; use a VPN if your ISP uses it.

For remote access, connect through a VPN or configure a reachable IP and firewall. `HIVE_MOBILE_BIND`, `HIVE_MOBILE_PUBLIC_URL`, `HIVE_MOBILE_TLS_CERT`, and `HIVE_MOBILE_TLS_KEY` remain available for custom network and certificate setups. `HIVE_MOBILE_TOKEN` can supply a token of at least 32 characters; otherwise Hive creates one and stores it in `~/.config/hive/mobile-token`.

## Connect through the TCP relay

Run the relay on a publicly reachable server:

```sh
node dist/cli.js relay --host 0.0.0.0 --port 47821
```

Generate a random pair ID and secret token for the relay address. End-to-end encryption is automatic. Add `--tls` when the relay has a trusted TLS certificate to also encrypt each network hop:

```sh
node dist/cli.js pair relay.example --port 47821
```

For TLS transport as well, append `--tls` to the `pair` command.

Build Hive CLI on the relay server and on the computer that owns the Codex sessions (`npm install && npm run build` in the Hive checkout). Restart the host agent after updating Hive so it uses relay protocol v3, which separates Codex, terminal, and file traffic into independent encrypted channels. Authenticate Codex on its host, then start the host agent with the generated URI:

```sh
node dist/cli.js daemon 'hive+tcp://relay.example:47821/<pair-id>?token=<secret>'
```

Paste the same URI into the desktop connection field. CLI `list`, `import`, and `resume` commands also accept that URI in place of an SSH target. Treat the full URI as a password.

The peers authenticate with the pair token, exchange ephemeral X25519 keys, and derive channel-specific directional AES-256-GCM keys with HKDF-SHA256. The relay receives an HMAC-derived routing tag instead of the pair token and forwards encrypted records; it cannot read or silently modify Codex, terminal, or file traffic. It can still observe connection metadata, traffic sizes, and timing. Optional TLS also protects transport metadata from network observers. The desktop app stores the full URI locally. Pi skill file discovery and reads currently require SSH and are unavailable through the relay.

## Browse remote sessions

```sh
node dist/cli.js list devbox
node dist/cli.js list devbox --cwd /srv/work/my-project --limit 200
node dist/cli.js list devbox --json
```

`--cwd` is a path on the remote computer. The thread list is fetched from Codex app-server and paginated, up to the requested limit.

## Import a transcript snapshot

```sh
node dist/cli.js import devbox <thread-id>
node dist/cli.js import devbox <thread-id> --cwd /srv/work/my-project
node dist/cli.js import devbox <thread-id> --out-dir ./session-archives
```

The importer reads the selected conversation with `thread/read` and saves the response as JSON under `~/.hive/codex-imports/` by default. Paginated Codex history is read through `thread/turns/list`; legacy history uses Codex's full-history read. The archive contains the remote host, Codex thread ID, working directory, import time, and the returned conversation history. The default archive directory and files are restricted to the current user on POSIX systems.

This creates a local transcript archive and a reference to the source thread. It does not copy the project directory or move the live Codex process. Use the `resume` command below to continue the saved conversation through Hive.

## Resume and interact with a remote session

```sh
node dist/cli.js resume devbox <thread-id>
```

This command uses the app-server connection to call `thread/resume` and `turn/start`; it does not launch Codex's native TUI or run `codex resume`. Hive displays streamed assistant text in its own terminal interface. Type a message after each turn, and use `/quit` to disconnect. Command and file-change approvals are shown as prompts (`y` for once, `s` for this session, `n` to decline). The session, project files, Codex configuration, authentication, and agent execution remain on the Codex host. Hive sets `excludeTurns: true` so paginated history stays in app-server storage rather than being loaded into the resume response.

The Hive prompt supports skill slash commands:

```text
/skills [filter]                 Browse skills grouped by source
/skill:<name> [request]          Invoke a selected skill
/skill:codex:<name> [request]    Select a Codex skill when names overlap
/skill:pi:<name> [request]       Select a Pi skill when names overlap
/help                            Show Hive commands
/quit                            Disconnect
```

Codex skills come from the remote app-server's `skills/list` response and are invoked using their Codex prompt. Pi skills are discovered under remote `~/.pi/agent/skills/` and `.pi/skills/` directories from the thread's working directory up to the repository root. Hive reads a Pi `SKILL.md` from the remote host only when explicitly invoked; it does not copy skill files into the Hive project. Codex's `$skill-name` prompt syntax also works when entered directly. Tab completes Hive commands.

Input Hive does not handle is sent to the remote Codex session as a regular message. TUI-only Codex screen commands are not dispatched by the app-server.

## Design

SSH mode starts Codex app-server and terminal PTYs through SSH. The Files view runs a bounded, read-only Python helper over SSH. Relay mode runs Codex app-server, terminal PTY, and file requests through separate connections to the host daemon. The relay keeps in-memory pairing state and forwards encrypted bytes without interpreting their contents.

The RPC payloads follow Codex's published app-server v2 schemas for [thread listing](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadListParams.ts), [thread reading](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadReadParams.ts), and [turn pagination](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTurnsListParams.ts). No Paseo source files are copied.

## License

BSD-2-Clause. See [LICENSE](../LICENSE).
