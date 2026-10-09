import type { CodexCliEvent } from "../../../../src/application/ports/codex-cli.js";
import { renderActivity, renderNotice, renderQuestionPrompt } from "./terminal-ui.js";
import { sanitizeTerminalChunk } from "./terminal-text.js";

type CodexApprovalEvent = Extract<CodexCliEvent, { type: "commandApproval" | "fileApproval" }>;
type Ask = (prompt: string) => Promise<string>;
type ApprovalResponder = {
  answerApproval(target: string, requestId: number | string, decision: "accept" | "acceptForSession" | "decline"): Promise<void>;
};

/** Present a Codex approval request in the interactive terminal and submit the user's choice. */
export async function handleCodexApprovalRequest(
  event: CodexApprovalEvent,
  responder: ApprovalResponder,
  ask: Ask,
): Promise<void> {
  if (event.type === "commandApproval") {
    process.stderr.write(`\n${renderNotice(`Codex requests permission to run a command${event.reason ? `: ${event.reason}` : ""}`, "warning")}`);
    if (event.command !== "(unavailable)") process.stderr.write(renderActivity("COMMAND", event.command));
    if (event.cwd) process.stderr.write(`  in ${sanitizeTerminalChunk(event.cwd)}\n`);
    const answer = await ask(renderQuestionPrompt("Allow once [y], for this session [s], or decline [n]?"));
    const decision = approvalDecision(answer);
    await responder.answerApproval(event.target, event.requestId, decision);
    if (event.itemId) process.stderr.write(`[Command approval: ${decision}]\n`);
    return;
  }

  process.stderr.write(`\n${renderNotice(`Codex requests permission to apply file changes${event.reason ? `: ${event.reason}` : ""}`, "warning")}`);
  if (event.itemId) process.stderr.write(`  Item: ${sanitizeTerminalChunk(event.itemId)}\n`);
  const answer = await ask(renderQuestionPrompt("Apply once [y], for this session [s], or decline [n]?"));
  await responder.answerApproval(event.target, event.requestId, approvalDecision(answer));
}

function approvalDecision(answer: string): "accept" | "acceptForSession" | "decline" {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") return "accept";
  if (normalized === "s" || normalized === "session") return "acceptForSession";
  return "decline";
}
