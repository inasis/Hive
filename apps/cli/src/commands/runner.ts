import type { CodexCliThreadRecord } from "../../../../src/application/ports/codex-cli.js";
import {
  parseDaemonOptions,
  parseSessionOptions,
} from "./arguments.js";
import { printHelp, printThreads } from "../presentation/output.js";

export type CliRuntime = {
  defaultArchiveDirectory(): string;
  listCodexThreads(target: string, options: { cwd?: string; limit: number }): Promise<CodexCliThreadRecord[]>;
  importCodexThread(target: string, threadId: string, options: { cwd?: string; outDir?: string }): Promise<string>;
  resumeCodexThread(target: string, threadId: string): Promise<void>;
  runDaemon(publicUrl?: string): Promise<void>;
  writeStdout(text: string): void;
};

/** Route parsed CLI commands to the configured application workflows. */
export async function runCli(args: string[], runtime: CliRuntime): Promise<void> {
  const [command, ...commandArgs] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    runtime.writeStdout(printHelp(runtime.defaultArchiveDirectory()));
    return;
  }

  if (command === "daemon") {
    await runtime.runDaemon(parseDaemonOptions(commandArgs));
    return;
  }

  const options = parseSessionOptions(commandArgs);
  if (command === "list") {
    const [target] = options.positional;
    if (!target || options.positional.length !== 1) {
      throw new Error("Usage: hive list <ssh-target> [--cwd <remote-path>] [--limit <n>] [--json]");
    }
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("--limit must be an integer from 1 to 500");
    }
    const threads = await runtime.listCodexThreads(target, {
      limit,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    runtime.writeStdout(options.json ? `${JSON.stringify(threads, null, 2)}\n` : printThreads(threads));
    return;
  }
  if (command === "import") {
    const [target, threadId] = options.positional;
    if (!target || !threadId || options.positional.length !== 2) {
      throw new Error(
        "Usage: hive import <ssh-target> <thread-id> [--cwd <remote-path>] [--out-dir <local-path>]",
      );
    }
    const filePath = await runtime.importCodexThread(target, threadId, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.outDir ? { outDir: options.outDir } : {}),
    });
    runtime.writeStdout(`Imported Codex session ${threadId}\nSaved transcript: ${filePath}\n`);
    runtime.writeStdout(
      "The live Codex session remains on the source computer; this file is a local history archive and source reference.\n",
    );
    return;
  }
  if (command === "resume") {
    const [target, threadId] = options.positional;
    if (!target || !threadId || options.positional.length !== 2) {
      throw new Error("Usage: hive resume <ssh-target> <thread-id>");
    }
    if (options.json || options.cwd || options.limit !== undefined || options.outDir) {
      throw new Error("The resume command does not accept options");
    }
    await runtime.resumeCodexThread(target, threadId);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
