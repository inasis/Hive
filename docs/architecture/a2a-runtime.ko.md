# Provider-neutral A2A session runtime

Hive now has a provider-neutral A2A runtime, a separate authenticated HTTP/SSE transport, adapters over Hive's existing Codex/OpenCode/Kiro session ports, and a profile-driven subprocess adapter for other documented CLIs or custom agents. The runtime does not inspect provider internals. Provider session identity, resume commands, cancellation, output parsing, and discovery stay inside adapters.

```text
HTTP/SSE or in-process caller
            │
      A2ARuntimePort
            │
 Room registry → router → task graph/state/queue
                              │
                       AgentAdapter port
                    ┌─────────┴──────────┐
             Hive provider ports   Configured CLI/API adapter
                    │                     │
          Codex / OpenCode / Kiro   explicitly configured agent
```

## Runtime contract

`src/domain/a2a.ts` contains provider-neutral room, agent, task, result, capability, and evidence contracts. `A2ARuntime` routes by room membership, role, capability tags, workspace, provider, and load. Task state is separate from agent state; each native session has a serial queue unless its adapter explicitly declares concurrency. Delegation records root/parent task IDs, depth, visited agents, and timeout. A task result does not expose the private adapter ID or native session handle through `AgentSummary`.

Persistence levels keep different meanings:

- Level 0 invokes the configured adapter without previous conversation state.
- Level 1 stores runtime-managed task history for state recovery, while task execution receives no previous-task history.
- Level 2 uses the adapter's native session mechanism. Hive provider adapters run each A2A task in a new temporary thread; configured CLI adapters may use their declared `resumeArgs`.
- Level 3 is reserved for a real attach-to-running-process operation. No built-in adapter claims Level 3.

The runtime does not restart a terminated native process. If the provider session cannot be reached, the node is `OFFLINE`. If cancellation is unavailable, timeout marks the node `ERROR` because the runtime cannot claim that native work stopped.

## Built-in Hive session adapters

`HiveSessionAgentAdapter` wraps the existing `ProviderCatalogPort`, `ProviderConversationPort`, `ProviderTurnsPort`, and assistant event stream for Codex, OpenCode, and Kiro. It opens registered session metadata without reading its transcript, creates a lightweight temporary thread in the same workspace, copies the model, reasoning effort, mode, and permission settings, submits only the current A2A request, and collects output from turn events. Codex task threads use `thread/start` with `ephemeral: true`; Hive verifies the returned thread is ephemeral and refuses a persistent fallback, so task work stays accessible through Hive's existing app-server connection without creating a durable Codex writer-locked session. It deletes the task thread and restores the registered thread only when the provider requires it; Codex and OpenCode preserve focus and skip that extra provider round trip. The prompt asks the agent to read workspace files when project context is needed. Cancellation interrupts the temporary provider turn. A2A uses an opaque local session handle that combines target and thread identity; summaries and events do not reveal it.

Hive A2A summaries include the provider-visible `sessionName`. `a2a_send` resolves `targetSessionName` first, then falls back to `targetAgent`; legacy callers that put a title in `targetAgent` still receive title-first matching. Name matching refreshes native session discovery so user-renamed and provider-generated titles are current. If a registered native caller names a target that is absent from the room, Hive creates a persistent provider session in the caller's workspace, applies the caller's supported permission profile, registers that session in the same room, broadcasts a `thread/created` bridge event so the Hive sidebar can show it immediately, and sends the task to it. When no target name is supplied, the provider-generated session title is retained. This creation fallback requires a Hive session adapter and a known caller workspace/permission profile; orchestrator and configured external adapters without native session creation fail closed.

These are Level 2 provider-session integrations, not Level 3 process attachment. They use the same provider connection as Hive and share its authentication and workspace access, but A2A task transcripts are isolated from the user's conversation. Each task runs in its own temporary thread and can be dispatched while the registered chat thread is active; this avoids deadlocking when a delegated agent asks the original session for input. Actual provider concurrency still depends on the provider and has not been verified for every adapter. Kiro's existing safe deletion path closes its ACP connection before deleting a session, so task cleanup reconnects and reloads the registered thread. Provider commands, authentication refresh, and live turn status were not exercised by the build or local adapter tests.

When a native session calls `a2a_send`, adapters that support permission-profile inheritance apply the caller's explicit profile to the temporary task thread. The registered target session's settings are left unchanged. This requires the caller profile to be representable by the target provider. OpenCode does not expose profile updates, so its temporary task thread uses the target session's model and OpenCode's native permissions. Direct tasks submitted by an HTTP/MCP orchestrator likewise use the target session's own configuration. Cross-provider profile translation remains unsupported for adapters using caller-profile inheritance.

Claude, Pi, Antigravity, and custom implementations are not assumed to expose a shared API. Without a configured profile, the registry shows them as `MANUAL_CONFIGURATION_REQUIRED` with all execution capabilities disabled. `ConfiguredCliAgentAdapter` accepts explicit executable, argument, session, resume, input/output, capability, cancellation, and evidence profiles. It launches commands without a shell. Resume is enabled only when a profile supplies `resumeArgs`; process attachment and native streaming are not inferred. The daemon can load a JSON array of these profiles from `HIVE_A2A_CLI_PROFILES_FILE`; a host can also supply `AgentAdapter` instances through `createAssistantRuntime({ a2aAdapters })` or `createA2ARuntime({ adapters })`.

Each profile lists existing sessions explicitly. Availability checks verify that the executable and declared workspace can be reached, but cannot prove that an arbitrary provider still recognizes the configured native session or that authentication is valid. The first resume invocation may therefore report a provider-specific failure. The following is only the configuration shape; command flags and output parsing must match the installed agent's documented interface:

```json
{
  "adapterId": "local-agent",
  "provider": "custom",
  "command": "/absolute/path/to/agent",
  "args": ["<verified new-session flags>"],
  "resumeArgs": ["<verified resume flags>", "{sessionId}"],
  "sessions": [{
    "sessionId": "native-session-id",
    "workspace": "/projects/example",
    "persistenceLevel": 2,
    "runtimeManagedHistory": false
  }],
  "promptDelivery": "argument",
  "outputFormat": "text",
  "capabilities": { "toolCalling": true, "fileAccess": true, "shellAccess": true },
  "integrationStatus": "PARTIALLY_VERIFIED",
  "evidence": {
    "source": "documented-command",
    "verifiedAt": "2026-09-29",
    "confidence": "medium",
    "limitations": ["Replace this example with actual verification notes."]
  }
}
```

`promptDelivery` can be `stdin` or `argument`; `stdinFormat` selects text or the A2A JSON envelope. The envelope keeps its `task`, `message`, and `history` fields, but `history` is empty and the prompt omits the room roster. `outputFormat` can be text, JSON with a `message`/`text` field, or NDJSON with an explicitly configured result event and text field. The command's static `args` and `resumeArgs` can use `{sessionId}`, `{workspace}`, and `{taskId}` placeholders. A cancellation capability is declared only when a cancellation command profile is present. These generic CLI profiles do not receive `a2a_send` automatically: a profile must supply a verified native MCP/tool injection path before it can advertise delegation. A profile's `resumeArgs` can still restore provider-owned conversation history; use a fresh-session profile when that provider behavior must be isolated.

## HTTP/SSE transport

`A2AHttpServer` is an independent transport adapter; it does not add methods to Hive's existing daemon wire contract. It requires an `Authorization: Bearer …` header with a token of at least 32 characters, accepts JSON request bodies up to 1 MiB by default, and exposes:

| Method and path | Purpose |
|---|---|
| `GET /v1/rooms` | List rooms |
| `POST /v1/rooms` | Create a room from `{ "roomId", "name" }` |
| `GET /v1/rooms/{roomId}/agents` | List public agent summaries |
| `POST /v1/rooms/{roomId}/discover` | Discover configured provider sessions; optional `{ "adapterId" }` |
| `POST /v1/rooms/{roomId}/refresh` | Refresh session availability |
| `PATCH /v1/agents/{agentId}` | Set `role` and/or `capabilities` |
| `POST /v1/tasks` | Enqueue a task and return HTTP 202 with its task record |
| `GET /v1/tasks/{taskId}` | Read task state/result |
| `POST /v1/tasks/{taskId}/cancel` | Request cancellation if supported |
| `GET /v1/task-graphs/{rootTaskId}` | Read a task graph |
| `GET /v1/adapters` | List adapter evidence and capabilities |
| `GET /v1/events` | Subscribe to runtime events over SSE |
| `POST /mcp` | Stateless MCP endpoint exposing `a2a_list_agents`, `a2a_send`, and `a2a_wait_task` |

Desktop, mobile, and relay daemons start this listener by default on `127.0.0.1:4760`. Set `HIVE_A2A_HTTP_ENABLED=false` to opt out or `HIVE_A2A_HTTP_BIND` to select another address. If `HIVE_A2A_HTTP_TOKEN` is not supplied, the daemon creates a private token at `${XDG_CONFIG_HOME:-~/.config}/hive/a2a-http-token`; `HIVE_A2A_HTTP_TOKEN_FILE` selects another token file. Binding to a non-loopback address requires `HIVE_A2A_TLS_CERT` and `HIVE_A2A_TLS_KEY`; cleartext HTTP remains limited to localhost/loopback. `HIVE_A2A_MCP_PUBLIC_URL` overrides the URL that provider integrations receive. The daemon starts the listener and provisions its URL/token before discovering sessions, then creates/finds `hive-default`. Desktop waits for this startup to finish before showing the session UI, so a new native session cannot race tool provisioning. `HIVE_A2A_ROOM_ID` and `HIVE_A2A_ROOM_NAME` override the default room. Provider target variables are JSON arrays in `HIVE_A2A_CODEX_TARGETS`, `HIVE_A2A_OPENCODE_TARGETS`, and `HIVE_A2A_KIRO_TARGETS`; an omitted variable uses `hive-local://`, while an explicit empty array disables that provider's target discovery. `HIVE_A2A_CLI_PROFILES_FILE` loads explicitly configured non-Hive CLI/custom adapters. `HIVE_A2A_STATE_FILE` enables durable local runtime state; without it the composition uses memory storage.

## State and limits

`FileA2ARuntimeStateStore` validates persisted JSON and writes atomically with owner-only permissions for new files. Persisted tasks contain request/result text and Level 1 history; protect the selected state file. It is a single-writer store and does not coordinate multiple runtime processes. Session discovery is cached for 15 seconds and concurrent refreshes share one provider scan. Previous native-root task records that incorrectly included the caller in the visited path are normalized on load and saved in the current format. On restart, in-flight tasks are marked failed instead of replayed, while known agents start offline until checked.

Hive provisions `a2a_list_agents`, `a2a_send`, and `a2a_wait_task` to its native Codex, OpenCode, and Kiro sessions. Codex receives a per-app-server MCP configuration overlay without editing its user config; managed OpenCode servers receive a remote MCP entry under `mcp.servers` through `OPENCODE_CONFIG_CONTENT`, with Code Mode disabled so the tools are available directly to the model; Kiro receives an ACP stdio MCP server in `session/new` and `session/load`. OpenCode's MCP `timeout.execution` is configured separately from tool task timeout. SSH-hosted Kiro uses an SSH reverse forward by default, or the configured public HTTPS MCP URL. `a2a_send` persists and queues a task, then returns only acceptance, task ID, and state without echoing the request. The caller uses `a2a_wait_task` with that ID to wait up to 20 seconds by default (30 seconds maximum); it repeats the call while `completed` is false and receives only the task result/status, not the stored request. The random task ID is the result-read capability and is protected in transit by the MCP bearer token. HTTP clients can poll `GET /v1/tasks/{taskId}` instead.

For native Hive session targets, the request itself is sent as a marked internal A2A communication so it does not appear as a user-authored transcript entry. Completed child requests emit request/result summaries to their caller sessions. When the root task finishes, the original caller receives the complete terminal task graph as one summary, with each request and response paired by task ID. The UI counts unique task IDs as `N개 통신 실행`, so a three-agent chain is shown as three communications rather than ordinary chat text; it is visible without waiting for another user prompt. The task prompt tells native agents to wait for actual child results before composing their own response; it no longer asks them to send an acceptance-only callback. `callbackForTaskId` remains available for older agents and explicit result callbacks; these compatibility callbacks are still queued for the next real provider prompt.

Nested MCP calls inherit their active task's root ID, parent ID, depth, visited-agent path, and cancellation signal. When an agent waits on a child task, Hive marks the parent `WAITING` and releases its workspace lock; it reacquires the lock before the parent continues. A registered session can therefore ask another agent to query the original session while the original model turn is waiting, and the response can return through each `a2a_wait_task` call. While an outbound request is active, Hive excludes its caller from fallback provider-target lookup so a call from another session on the same provider target resolves to the receiving agent. A terminated or unreachable provider process still needs its own supervisor; failed request or callback tasks remain visible in runtime state.

Tool availability follows the native injection path. OpenCode sessions connected to an external `HIVE_OPENCODE_URL` cannot be modified by Hive and do not get the injected tool. SSH-hosted Kiro requires Node.js on the remote host for the stdio bridge; `HIVE_A2A_REMOTE_NODE_BIN` selects its executable. Other configured CLI/custom agents must declare and verify their own native MCP/tool profile. Codex, OpenCode, and Kiro availability is still bounded by provider authentication, permissions, workspace configuration, and provider process health. An in-process workspace lock serializes A2A tasks whose normalized workspace paths match and releases the parent lease while that agent waits for a delegated child. It does not protect edits from outside this runtime, other daemon processes, symlink aliases, or file-level overlap; Git worktree isolation remains a host option. Workspace and native session context stay separate.

## Verification status

`npm run build` and `node tests/a2a-performance.test.mjs` (11 checks) pass. Local fakes exercise a three-agent chain (caller → Agent 1 → Agent 2 → caller), task-result collection, task-parent persistence, shared-workspace lock release/reacquisition, grouped communication-summary delivery, MCP wait-result shape and `tools/list`, Codex app-server MCP configuration, OpenCode permissions for all three A2A tools, prompt isolation, provider-thread cleanup, session discovery, configured CLI history trimming, and normalization of the previous native-root task path during state restore.

A live Codex CLI 0.159.0 smoke test against the local loopback MCP server discovered the three tools and called `a2a_list_agents → a2a_send → a2a_wait_task`, receiving the stubbed result `자전거`. The MCP caller path and Codex tool invocation were live, but the A2A runtime used a fake task backend; this did not exercise nested real Codex agent dispatch. Codex 0.159.0 also reported `experimental_use_rmcp_client` as an unrecognized setting, so the Codex transport no longer passes that obsolete flag.

The already-running local daemon's authenticated `/mcp tools/list` also returns only `a2a_list_agents` and `a2a_send`, with the older callback-return description. Its Codex app-server was launched before the current build. Two requests to the existing Codex Agent 1 were accepted, but Agent 2 remained idle and no result was visible. The source and isolated local server return all three tools, so the running daemon/provider processes need to be restarted from this worktree before the actual asynchronous agent chain can be verified.

An earlier OpenCode v2.0.16 session accepted the managed `mcp.servers.hivea2a` configuration with `codemode: false` and connected with two tools; that observation predates the local permission fix for `a2a_wait_task`. Every OpenCode test session used only `ornith/ornith-1`. The caller's first model turn remained without output for over ten minutes and was interrupted. Endpoint health and model-list GET requests returned HTTP 200 and identified `ornith-1`; streaming and non-streaming `/v1/chat/completions` requests timed out at 60 seconds, and a direct non-streaming request capped at one output token received zero bytes before its 120-second timeout. Further read-only diagnostics showed `total_slots: 1` with a continuously processing request, while OpenCode's active-session list did not identify the request as either test session. No further prompt was sent to avoid competing with an unowned request. No OpenCode `a2a_send` task was created, so the actual OpenCode model-to-model round-trip remains unverified pending an idle, attributable model slot. Provider cancellation against live sessions, Kiro runtime interoperability, and hardware/UI behavior have not been executed here. An integration is reported as partially verified/experimental according to its explicit evidence; adapters without a confirmed transport should be configured by profile rather than guessed from a product name.
