import { A2AMcpToolDispatcher } from "../dist/infrastructure/transport/a2a-mcp-tool-dispatcher.js";

export function callMcpTool(runtime, params, url, request = { headers: {} }) {
  return new A2AMcpToolDispatcher(runtime).dispatch(params, url, request);
}
