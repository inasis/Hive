import { CodexArchiveFileAdapter } from "../../../../src/infrastructure/persistence/codex-archive.js";
import { CodexCliAdapter } from "../../../../src/infrastructure/providers/codex/cli.js";
import { CodexCliSessionUseCases, CodexCliUseCases } from "../../../../src/application/use-cases/codex-cli.js";
import { ProviderApprovalUseCases } from "../../../../src/application/use-cases/provider-approvals.js";
import { ProviderTurnUseCases } from "../../../../src/application/use-cases/provider-turns.js";
import type { CodexCliEvent } from "../../../../src/application/ports/codex-cli.js";
import { createAssistantRuntime } from "../../../../src/infrastructure/composition/assistant-runtime.js";
import { runHiveWssDaemon } from "../../../daemon/src/composition/wss-daemon.js";
import { resumeCodexThread } from "../presentation/resume.js";
import { runCli } from "../commands/runner.js";
import { runA2AMcpStdioProxy } from "../../../../src/infrastructure/transport/a2a-mcp-stdio.js";

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
  const sessions = new CodexCliSessionUseCases(
    codexAdapter,
    runtime.providerPorts.codexCliSessions,
    runtime.providerPorts.codexCliSkills,
  );
  const turns = new ProviderTurnUseCases<"codex">({ codex: runtime.providerPorts.turns.codex });
  const approvals = new ProviderApprovalUseCases<"codex">({ codex: runtime.providerPorts.approvals.codex });
  process.once("exit", () => runtime.providerContexts.kiro.terminateAll());
  process.once("exit", () => runtime.providerContexts.pi.terminateAll());

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
    disconnect: (requestedTarget) => runtime.providerPorts.catalogs.codex.disconnect(requestedTarget),
  });
}

/** Assemble and run the standalone CLI process. */
export function runHiveCli(args: string[]): Promise<void> {
  if (args[0] === "a2a-mcp" && args[1] === "--stdio" && args.length === 2) return runA2AMcpStdioProxy();
  return runCli(args, {
    defaultArchiveDirectory: () => codexCli.defaultArchiveDirectory(),
    listCodexThreads: (target, options) => codexCli.listThreads(target, options),
    importCodexThread: (target, threadId, options) => codexCli.importThread(target, threadId, options),
    resumeCodexThread: runCodexResume,
    runDaemon: (publicUrl) => runHiveWssDaemon(publicUrl),
    writeStdout: (text) => process.stdout.write(text),
  });
}
