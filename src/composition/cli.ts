import { randomBytes } from "node:crypto";
import { CodexArchiveFileAdapter } from "../adapters/persistence/codex-archive.js";
import { CodexCliAdapter } from "../adapters/providers/codex/cli.js";
import { parseHiveRelayTarget } from "../adapters/transport/relay-target.js";
import { CodexCliSessionUseCases, CodexCliUseCases } from "../application/use-cases/codex-cli.js";
import { ProviderApprovalUseCases } from "../application/use-cases/provider-approvals.js";
import { ProviderTurnUseCases } from "../application/use-cases/provider-turns.js";
import type { CodexCliEvent } from "../application/ports/codex-cli.js";
import { createAssistantRuntime } from "./assistant-runtime.js";
import { runHiveMobileDaemon } from "./mobile-daemon.js";
import { runHiveRelayAgent } from "./relay-agent.js";
import { runHiveRelayServer } from "./relay-server.js";
import { resumeCodexThread } from "../interfaces/cli/resume.js";
import { runCli } from "../interfaces/cli/runner.js";
import { runA2AMcpStdioProxy } from "../adapters/transport/a2a-mcp-stdio.js";

const codexAdapter = new CodexCliAdapter();
const archiveAdapter = new CodexArchiveFileAdapter();
const codexCli = new CodexCliUseCases(codexAdapter, archiveAdapter);

function runCodexResume(target: string, threadId: string): Promise<void> {
  const listeners = new Set<(event: CodexCliEvent) => void>();
  const runtime = createAssistantRuntime(
    () => {},
    () => {},
    (event) => { for (const listener of listeners) listener(event); },
  );
  const sessions = new CodexCliSessionUseCases(codexAdapter, runtime.codexProvider);
  const turns = new ProviderTurnUseCases<"codex">({ codex: runtime.codexProvider });
  const approvals = new ProviderApprovalUseCases<"codex">({ codex: runtime.codexProvider });
  process.once("exit", runtime.terminateKiro);

  return resumeCodexThread(target, threadId, {
    validateTarget: (requestedTarget) => sessions.validateTarget(requestedTarget),
    validateThreadId: (requestedThreadId) => sessions.validateThreadId(requestedThreadId),
    openSession: (requestedTarget, requestedThreadId) => sessions.openSession(requestedTarget, requestedThreadId),
    buildSkillInput: (requestedTarget, requestedThreadId, selector, request) =>
      sessions.buildSkillInput(requestedTarget, requestedThreadId, selector, request),
    sendPrompt: async (requestedTarget, requestedThreadId, text) => {
      await turns.sendPrompt("codex", requestedTarget, requestedThreadId, { text });
    },
    answerApproval: async (requestedTarget, requestId, decision) => {
      await approvals.answerApproval("codex", requestedTarget, requestId, decision);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    disconnect: (requestedTarget) => runtime.codexProvider.disconnect(requestedTarget),
  });
}

/** Assemble and run the standalone CLI process. */
export function runHiveCli(args: string[]): Promise<void> {
  if (args[0] === "a2a-mcp" && args[1] === "--stdio" && args.length === 2) return runA2AMcpStdioProxy();
  return runCli(args, {
    defaultArchiveDirectory: () => codexCli.defaultArchiveDirectory(),
    isRelayTarget: (target) => Boolean(parseHiveRelayTarget(target)),
    listCodexThreads: (target, options) => codexCli.listThreads(target, options),
    importCodexThread: (target, threadId, options) => codexCli.importThread(target, threadId, options),
    resumeCodexThread: runCodexResume,
    runRelay: runHiveRelayServer,
    runDaemon: runHiveRelayAgent,
    runMobileDaemon: async (publicUrl) => {
      if (publicUrl) process.env.HIVE_MOBILE_PUBLIC_URL = publicUrl;
      await runHiveMobileDaemon();
    },
    createPairingUri: (host, port, tls) => {
      const pairId = randomBytes(16).toString("hex");
      const token = randomBytes(32).toString("hex");
      return `${tls ? "hive+tls" : "hive+tcp"}://${host}:${port}/${pairId}?token=${token}`;
    },
    writeStdout: (text) => process.stdout.write(text),
  });
}
