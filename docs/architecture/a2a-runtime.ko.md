# Provider-neutral A2A/A2B session runtime

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

See [A2A/A2B flows and development direction](./a2a-a2b-flows.ko.md) for the async request/response diagrams, bonded-agent restrictions, and implementation priorities.

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

`promptDelivery` can be `stdin` or `argument`; `stdinFormat` selects text or the A2A JSON envelope. The envelope keeps its `task`, `message`, and `history` fields, but `history` is empty and the prompt omits the room roster. `outputFormat` can be text, JSON with a `message`/`text` field, or NDJSON with an explicitly configured result event and text field. The command's static `args` and `resumeArgs` can use `{sessionId}`, `{workspace}`, and `{taskId}` placeholders. A cancellation capability is declared only when a cancellation command profile is present. These generic CLI profiles do not receive `a2a_send` automatically. A structured `delegation` profile routes JSON/NDJSON delegation records through Hive's runtime; response records can set `responseForTaskId` or `callbackForTaskId`, and the runtime applies the same A2A/A2B checks as its MCP path. A profile using its own native MCP/tool path must configure and verify that integration explicitly. A profile's `resumeArgs` can still restore provider-owned conversation history; use a fresh-session profile when that provider behavior must be isolated.

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
| `POST /mcp` | Stateless MCP endpoint exposing `a2a_list_agents`, `a2a_send`, and `a2b_send` |

The daemon starts this listener by default on `127.0.0.1:4760`; the desktop app connects to its configured daemon and does not start a second listener. Set `HIVE_A2A_HTTP_ENABLED=false` to opt out or `HIVE_A2A_HTTP_BIND` to select another address. If `HIVE_A2A_HTTP_TOKEN` is not supplied, the daemon creates a private token at `${XDG_CONFIG_HOME:-~/.config}/hive/a2a-http-token`; `HIVE_A2A_HTTP_TOKEN_FILE` selects another token file. Binding to a non-loopback address requires `HIVE_A2A_TLS_CERT` and `HIVE_A2A_TLS_KEY`; cleartext HTTP remains limited to localhost/loopback. `HIVE_A2A_MCP_PUBLIC_URL` overrides the URL that provider integrations receive. The daemon starts the listener and provisions its URL/token before discovering sessions, then creates/finds `hive-default`. `HIVE_A2A_ROOM_ID` and `HIVE_A2A_ROOM_NAME` override the default room. Provider target variables are JSON arrays in `HIVE_A2A_CODEX_TARGETS`, `HIVE_A2A_OPENCODE_TARGETS`, and `HIVE_A2A_KIRO_TARGETS`; an omitted variable uses `hive-local://`, while an explicit empty array disables that provider's target discovery. `HIVE_A2A_CLI_PROFILES_FILE` loads explicitly configured non-Hive CLI/custom adapters. `HIVE_A2A_STATE_FILE` enables durable local runtime state; without it the composition uses memory storage.

## State and limits

`FileA2ARuntimeStateStore` validates persisted JSON and writes atomically with owner-only permissions for new files. Persisted tasks contain request/result text and Level 1 history; protect the selected state file. It is a single-writer store and does not coordinate multiple runtime processes. Session discovery is cached for 15 seconds and concurrent refreshes share one provider scan. Previous native-root task records that incorrectly included the caller in the visited path are normalized on load and saved in the current format. On restart, in-flight tasks are marked failed instead of replayed, while known agents start offline until checked.

Hive provisions `a2a_list_agents`, `a2a_send`, and `a2b_send` to its native Codex, OpenCode, and Kiro sessions. Codex receives a per-app-server MCP configuration overlay without editing its user config; managed OpenCode servers receive a remote MCP entry under `mcp.servers` through `OPENCODE_CONFIG_CONTENT`, with Code Mode disabled so the tools are available directly to the model; Kiro receives an ACP stdio MCP server in `session/new` and `session/load`. OpenCode's MCP `timeout.execution` is configured separately from tool task timeout. SSH-hosted Kiro uses an SSH reverse forward by default, or the configured public HTTPS MCP URL. Both send tools persist and queue a task, then return only acceptance, task ID, and state without echoing the request. The sending agent continues its own turn; neither prompt instructions nor exposed tools ask it to poll or wait for completion. Task state and results remain available to HTTP clients through `GET /v1/tasks/{taskId}` and `GET /v1/events`. The MCP handler still accepts the old `a2a_wait_task` call for existing clients, but no longer advertises it to agents.

`a2a_send` starts an A2A request. The assigned agent must deliver its response to a chosen existing agent or newly named session. It sets `responseForTaskId` to the active task ID so Hive marks the new task as `a2a-result-delivery`; the receiver may forward the result, return it once to its sender with `callbackForTaskId`, or finish. A recipient of that return callback may forward the result or finish but cannot send another callback. To return the response to the original caller, the responder sends an A2A callback with `callbackForTaskId`. A request responder is marked failed if its task completes without an accepted response delivery or callback. Once `a2a_send` accepts the response delivery, it is successful; the sender does not wait for the recipient's task to finish. A callback immediately queues a new root task for the original caller's registered adapter and session; it does not wait for the caller's next user prompt or create a cycle in the original task graph. Hive does not automatically bubble a result up the task graph. `a2b_send` requires an exact registered `agentId` and starts a task-scoped bond to that agent. Its task result is the response; runtime checks reject any new A2A/A2B delegation from the bonded task, including configured CLI delegation. The bonded agent may send a result callback only to the original caller for that A2B task.

For native Hive session targets, the request itself is sent as a marked internal A2A communication so it does not appear as a user-authored transcript entry. Completed requests emit request/result summaries to their direct caller sessions. The root caller's summary includes tasks already terminal when the root finishes; later descendants report to their direct caller. An agent that needs the original caller to resume with a later result can send a `callbackForTaskId` callback, which schedules a new task on that caller's session. The UI counts unique task IDs as `N개 통신 실행`, separate from ordinary chat text.

Nested A2A sends inherit their active task's root ID, parent ID, depth, visited-agent path, and cancellation signal. Sending a child task does not move the parent to `WAITING` or hold its provider turn open; the child runs independently after acquiring its own workspace lock. A valid callback is a new root task on the original caller's registered adapter/session, queued behind any active task for that agent. While an outbound request is active, Hive excludes its caller from fallback provider-target lookup so a call from another session on the same provider target resolves to the receiving agent. A terminated or unreachable provider process still needs its own supervisor; failed request or callback tasks remain visible in runtime state.

Tool availability follows the native injection path. OpenCode sessions connected to an external `HIVE_OPENCODE_URL` cannot be modified by Hive and do not get the injected tools. SSH-hosted Kiro requires Node.js on the remote host for the stdio bridge; `HIVE_A2A_REMOTE_NODE_BIN` selects its executable. Other configured CLI/custom agents must declare and verify their own native MCP/tool profile. Codex, OpenCode, and Kiro availability is still bounded by provider authentication, permissions, workspace configuration, and provider process health. An in-process workspace lock serializes A2A tasks whose normalized workspace paths match. Since requesters do not wait for child tasks, a requester releases its workspace lease when its own task ends; each child then acquires its own lease. The lock does not protect edits from outside this runtime, other daemon processes, symlink aliases, or file-level overlap; Git worktree isolation remains a host option. Workspace and native session context stay separate.

## Verification status

`npm run build` and `node --test --test-timeout=15000 tests/*.test.mjs` pass 35 mock-based checks. They verify acceptance while provider work is still running, active-caller permission inheritance, failure when an A2A request responder only returns a local task result, response delivery through both MCP and the internal adapter port, delivery to existing/new agents and recipient forwarding, callback return and finish choices, cross-room and stale callback rejection, visible offline callback failure, workspace-lock release after sender completion, queued-task cancellation and timeout, Codex metadata inspection without resuming an active writer, callback execution as a separate root task (including duplicate-race rejection), A2B exact-target rules and bonded prompt, branch rejection through MCP and the internal delegate port, provider-specific A2A prompt delivery for Codex/OpenCode/Kiro, and OpenCode/Kiro MCP provisioning. A task adapter receives only the registered source and target summaries, even in a room with 100 other agents; agents without an A2A send capability are rejected before provider execution. Structured CLI delegation preserves response IDs and receives task-specific A2A/A2B instructions. The MCP tool list exposes asynchronous A2A/A2B sends without a wait tool.

A live Codex CLI 0.159.2 smoke used the running local Hive daemon and actual Codex agents. In the A2A run, the sender used `a2a_send`, returned before its child task finished, and the child returned the expected sentinel in 17.3 seconds. In the A2B run, `a2b_send` created a task with `delivery=a2b-bonded-request`, the sender again finished before its child, and the bonded response matched the sentinel in 21.8 seconds. The model requests explicitly prohibited file reads and writes; this confirms MCP dispatch and asynchronous task behavior against the running daemon, not the newly edited prompt text. The daemon advertises `a2a_list_agents`, `a2a_send`, and `a2b_send` with no wait tool, but its loaded A2A description predates the latest response-recipient wording. All 12 registered Codex agents were `IDLE` after these runs.

An additional live callback attempt against the older running daemon reached the Codex responder, but the daemon rejected its callback with `Delegation would revisit an agent`; it did not create a callback task. The initial isolated current-source run also exposed a provider-session problem: all five registered Codex threads rejected `thread/resume` with `thread already has an active writer`, while `thread/read` with `includeTurns:false` succeeded. Minimal A2A inspection now reads session metadata without resuming the interactive thread or stealing focus, and active-task permission lookup uses the ephemeral task thread. After this change, an isolated current-source run on `127.0.0.1:4761` accepted an A2A task, let its sender finish while the responder was still running, then delivered the response to an existing agent with `responseForTaskId`; the responder and recipient tasks completed independently. In that run, the recipient chose to callback, and a further callback was stopped manually before the one-return guard was added. A separate live run on the guarded source completed an A2A callback to the original caller; the sender had already finished, and all five isolated Codex agents returned to `IDLE`. The callback guard does not change the `responseForTaskId` delivery path. The active daemon still runs older code and prompt; no restart was performed, so current-source behavior has not been checked in that daemon.

The daemon's room currently contains only Codex agents, so no registered OpenCode or Kiro target was available for a task. OpenCode v2.0.16 is running, but a prior test recorded an unresponsive `ornith/ornith-1` model slot; no further prompt was sent to avoid competing with an unowned request. Kiro CLI 2.24.1 is installed and ACP processes are running, but the room has no registered Kiro session. OpenCode/Kiro A2A/A2B dispatch, live provider cancellation, and hardware/UI behavior remain unverified. An integration is reported as partially verified/experimental according to its explicit evidence; adapters without a confirmed transport should be configured by profile rather than guessed from a product name.
