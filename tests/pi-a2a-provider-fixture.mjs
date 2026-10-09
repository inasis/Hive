export const fakePiRpcSource = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
let input = "";
const args = process.argv.slice(2);
const argument = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const extensionPath = argument("--extension");
if (!extensionPath || !existsSync(extensionPath) || !readFileSync(extensionPath, "utf8").includes('register("a2b_send"')) {
  process.stderr.write("Hive A2A extension was not loaded\\n");
  process.exit(2);
}
appendFileSync(process.env.HIVE_PI_TEST_ARGUMENT_LOG, JSON.stringify({ args, extensionPath }) + "\\n", { mode: 0o600 });
const sessionDirectory = resolve(argument("--session-dir"));
mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
const selectedSession = argument("--session");
let sessionFile;
let sessionId;
if (selectedSession) {
  sessionFile = resolve(selectedSession);
  const header = JSON.parse(readFileSync(sessionFile, "utf8").split("\\n", 1)[0]);
  sessionId = header.id;
} else if (!args.includes("--no-session")) {
  sessionId = randomUUID();
  sessionFile = join(sessionDirectory, sessionId + ".jsonl");
  writeFileSync(sessionFile, JSON.stringify({ type: "session", id: sessionId, cwd: process.cwd(), timestamp: new Date().toISOString() }) + "\\n", { mode: 0o600 });
} else {
  sessionId = randomUUID();
}
let sessionName;
const model = { provider: "test-provider", id: "test-model", name: "Test model", contextWindow: 64000, maxTokens: 4096, reasoning: true, input: ["text"] };
function send(command, data = {}) {
  process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data }) + "\\n");
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  let newline;
  while ((newline = input.indexOf("\\n")) >= 0) {
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    switch (command.type) {
      case "get_state": send(command, { model, thinkingLevel: "medium", sessionId, ...(sessionFile ? { sessionFile } : {}), ...(sessionName ? { sessionName } : {}) }); break;
      case "get_available_models": send(command, { models: [model] }); break;
      case "get_available_thinking_levels": send(command, { levels: ["off", "medium"] }); break;
      case "set_session_name": sessionName = command.name; send(command); break;
      case "get_commands": send(command, { commands: [] }); break;
      case "get_messages": send(command, { messages: [] }); break;
      case "get_fork_messages": send(command, { messages: [] }); break;
      default: send(command);
    }
  }
});
`;

