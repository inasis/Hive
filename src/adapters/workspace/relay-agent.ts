import type { Duplex } from "node:stream";
import { LOCAL_WORKSPACE_TARGET } from "../../domain/workspace.js";
import type { WorkspaceFilePort } from "../../application/ports/workspace-files.js";
import { readRelayAgentMessages, writeRelayAgentMessageAndEnd } from "../transport/relay-agent-control.js";

type RelayAgentWorkspaceFiles = Pick<WorkspaceFilePort, "list" | "read">;

/** Serve relay workspace requests through the injected workspace port. */
export async function serveRelayAgentWorkspaceFiles(
  stream: Duplex,
  workspaceFiles: RelayAgentWorkspaceFiles,
): Promise<void> {
  for await (const message of readRelayAgentMessages(stream, 32 * 1024)) {
    try {
      if (typeof message.cwd !== "string" || typeof message.path !== "string") throw new Error("Invalid workspace request");
      if (message.operation === "list") {
        const listing = await workspaceFiles.list(LOCAL_WORKSPACE_TARGET, message.cwd, message.path);
        await writeRelayAgentMessageAndEnd(stream, listing);
      } else if (message.operation === "read") {
        const preview = await workspaceFiles.read(LOCAL_WORKSPACE_TARGET, message.cwd, message.path);
        await writeRelayAgentMessageAndEnd(stream, preview);
      } else {
        throw new Error("Unknown workspace operation");
      }
    } catch (error) {
      await writeRelayAgentMessageAndEnd(stream, { error: errorMessage(error) });
    }
    return;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
