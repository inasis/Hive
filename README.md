# Hive

Hive is an Electrobun desktop app and Android client for browsing sessions from AI coding providers. It supports Codex app-server, the OpenCode HTTP server, and Kiro CLI over ACP. Linux desktop and Android connect to a Hive daemon over authenticated WSS by default; desktop apps also support direct SSH or Hive TCP relay connections.

```text
Linux desktop / Android (shared React UI) ───── WSS ── Hive daemon
                                                      ├── Codex app-server
                                                      ├── OpenCode HTTP API
                                                      ├── Kiro CLI / ACP
                                                      └── SSH / Hive TCP relay ── workspace host
```

## Project layout

- `apps/desktop`: Electrobun host process and React/Vite UI.
- `apps/android`: Capacitor Android wrapper for the shared UI.
- `src`: WSS daemon, Codex, OpenCode, and Kiro provider adapters, SSH and TCP relay transports, terminal/file tools, and CLI.

Electrobun builds desktop apps for Linux, Windows, and macOS. Linux and Android use the daemon pairing screen by default; Linux can switch to direct SSH or relay mode. The Android phone connects to a Hive daemon and does not run SSH or Codex locally.

The daemon WSS API exposes `listProviders`, including each provider's capabilities. Provider-specific requests accept a `provider` ID; older clients that omit it continue to use Codex, while unknown IDs are rejected. `connect` returns the selected provider's models, and `updateThreadSettings` applies a model to an open session.

## Connect Kiro

Install and sign in to Kiro CLI on the Hive host, then select **Kiro** in connection settings. Hive uses `kiro-cli acp` for chat sessions and the Kiro CLI session commands to list and delete sessions. Local sessions on the Hive host and SSH hosts are supported; Kiro is not available through the Hive TCP relay. For a local CLI that is not on PATH, set `HIVE_KIRO_BIN` to its executable path before starting Hive. SSH hosts need `kiro-cli` on their non-interactive shell PATH.

Kiro sessions expose model and reasoning effort selection, agent modes, tool approvals, slash commands, and skills from the Kiro skill directories. New sessions can start with additive Kiro permission presets. Hive handles Kiro ACP workspace file reads and writes, and command terminals, within the selected workspace. Attach or paste images into Kiro prompts. Session names are saved as Hive list aliases. Completed responses can be forked, and `/rewind <number>` opens a new session from an earlier prompt. The public ACP docs do not define a live-steering request that Hive can connect to.

## Desktop development

Requirements: Node.js 20 or newer and npm.

```sh
npm ci --prefix apps/desktop
npm run desktop:dev
```

Build the desktop package with `npm run desktop:build`. On Linux, Electrobun also needs GTK 3 and WebKitGTK 4.1 development libraries. Linux opens the daemon pairing screen first; choose **SSH 또는 릴레이로 직접 연결** to use an SSH target such as `user@host` or a `hive+tcp://` / `hive+tls://` relay URI instead.

## Android build

Requirements: Node.js 20 or newer, Java 17 or newer, and Android SDK platform 35 with Build Tools 35.0.0.

```sh
./scripts/build-android.sh
```

The script builds the shared React UI, syncs it into the Capacitor Android project, and stages a debug APK at `artifacts/android/Hive-android-debug.apk`. Android Studio can open `apps/android/android` for device runs and release signing.

## Connect Linux desktop or Android to the daemon by IP

No domain or manually supplied TLS certificate is needed. Connect the Android phone and the computer running Hive to the same Wi-Fi, then start the daemon on the Codex host:

```sh
npm ci
npm run daemon
```

`npm run daemon` builds and starts the daemon in one step. It prints LAN addresses such as `wss://192.168.x.x:4753/rpc`, a certificate SHA-256 fingerprint, and a pairing token. Enter all three once in the Linux desktop or Android pairing screen. If it prints multiple addresses, choose the one on the same Wi-Fi as the client. Allow TCP port 4753 through the computer's firewall. The clients pin the daemon certificate to the fingerprint you entered. The daemon stores its generated certificate and token under `~/.config/hive/` for later runs. Stop it with Ctrl+C.

For access from outside your home network, forward TCP port 4753 on your router to port 4753 on the daemon computer (for example, `192.168.0.5`) and allow it through the computer's firewall. To have the daemon print your public address, run:

```sh
npm run daemon -- --public-url wss://203.0.113.10:4753/rpc
```

Replace the example address with your public IP, then enter the printed `wss://<public-ip>:4753/rpc` address in the client. Port forwarding may not work behind carrier-grade NAT; use a VPN in that case.

After pairing, the client connects directly to the local Codex CLI on the daemon computer; it does not ask for a second SSH target or relay URI. Codex must be installed and signed in for the same user that runs the daemon. The daemon computer must remain on and reachable from the client. For access away from home, use a VPN or configure a reachable IP and firewall.

The Linux desktop app and Android app store the daemon address, fingerprint, and token locally. **데몬 연결 설정 변경** clears the saved pairing. Delete `~/.config/hive/mobile-token` to rotate the generated token.

## Connect OpenCode

Choose the **OpenCode** provider in connection settings. At startup, the Hive daemon runs `opencode serve --hostname 127.0.0.1 --port 4096` and reads the server password printed by the OpenCode CLI to connect automatically. The password is held in memory and does not need to be entered in the app. Install the OpenCode CLI and sign in to providers as the same user that runs Hive.

```sh
# Set the CLI path if opencode is not on PATH
export HIVE_OPENCODE_BIN="$HOME/.opencode/bin/opencode"
npm run daemon
```

To connect to an existing OpenCode server, set `HIVE_OPENCODE_URL`. Hive will not start another server in this mode. For a server using Basic auth, also set its username and password. Restart the daemon after changing these variables.

```sh
export HIVE_OPENCODE_URL=http://opencode-host:4096
export HIVE_OPENCODE_USERNAME=opencode
export HIVE_OPENCODE_PASSWORD='existing server password'
npm run daemon
```

If `HIVE_OPENCODE_URL` is unset, the daemon owns a server at the default address. You can set fixed credentials with `HIVE_OPENCODE_USERNAME`/`HIVE_OPENCODE_PASSWORD` or OpenCode's `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`. For Android and paired clients, OpenCode and workspaces run on the daemon host. OpenCode manages its own provider API keys and model settings.

## CLI

Build and run the session CLI:

```sh
npm ci
npm run build
node dist/cli.js --help
```

See [the CLI and desktop guide](./docs/codex-bridge.md) for relay setup, session browsing, transcript archives, and resume commands.

## License

Hive source code is BSD-2-Clause. See [LICENSE](./LICENSE). Electrobun, Capacitor, and the other dependencies retain their own licenses.
