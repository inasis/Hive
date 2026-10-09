import type { CodexCliEvent } from "../../../../src/application/ports/codex-cli.js";
import { renderActivity, renderAssistantStart, renderNotice, renderTurnComplete } from "./terminal-ui.js";
import { sanitizeTerminalChunk } from "./terminal-text.js";

type CodexResumePresentationEvent = Extract<
  CodexCliEvent,
  { type: "commandStarted" | "fileChangesStarted" | "assistantDelta" | "turnCompleted" | "warning" }
>;

/** Owns Codex resume event output and the active turn completion waiter. */
export class CodexResumeEventPresenter {
  private resolveCurrentTurn: (() => void) | undefined;
  private assistantOutputOpen = false;

  present(event: CodexResumePresentationEvent): void {
    if (event.type === "commandStarted") {
      process.stderr.write(`\n${renderActivity("COMMAND", event.command)}`);
    } else if (event.type === "fileChangesStarted") {
      process.stderr.write(`\n${renderActivity("FILE CHANGES", "Codex is preparing edits")}`);
    } else if (event.type === "assistantDelta") {
      if (event.text.length > 0) {
        if (!this.assistantOutputOpen) {
          process.stdout.write(renderAssistantStart());
          this.assistantOutputOpen = true;
        }
        process.stdout.write(sanitizeTerminalChunk(event.text));
      }
    } else if (event.type === "turnCompleted") {
      if (this.assistantOutputOpen) process.stdout.write("\n");
      process.stdout.write(`${renderTurnComplete(event.status)}\n`);
      this.assistantOutputOpen = false;
      if (event.error) process.stderr.write(renderNotice(`Codex error: ${event.error}`, "error"));
      this.resolveCurrentTurn?.();
      this.resolveCurrentTurn = undefined;
    } else if (event.type === "warning") {
      process.stderr.write(`\n${renderNotice(`Codex warning: ${event.message}`, "warning")}`);
    }
  }

  async sendPromptAndWait(sendPrompt: () => Promise<void>): Promise<void> {
    const completed = new Promise<void>((resolve) => { this.resolveCurrentTurn = resolve; });
    try {
      await sendPrompt();
      await completed;
    } finally {
      this.resolveCurrentTurn = undefined;
    }
  }
}
