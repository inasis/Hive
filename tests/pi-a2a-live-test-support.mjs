import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export function saveEnvironment(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

export function createFakeOpenAIModelServer(requests) {
  return createServer((request, response) => {
    void readJsonBody(request).then((body) => {
      if (request.headers.authorization !== "Bearer hive-test-only-key") {
        response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "fixture auth failed" } }));
        return;
      }
      if (!request.url?.endsWith("/chat/completions")) {
        response.writeHead(404).end();
        return;
      }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const prompt = messages.map((message) => typeof message.content === "string" ? message.content
        : Array.isArray(message.content) ? message.content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n")
          : "").join("\n");
      const hasToolResult = messages.some((message) => message.role === "tool");
      const availableTools = (Array.isArray(body.tools) ? body.tools : [])
        .map((tool) => tool?.function?.name).filter((name) => typeof name === "string");
      let toolCall;
      let text = "HIVE_PI_A2A_OK";
      if (!hasToolResult && prompt.includes("A2A request from pi-a2a-caller")) {
        const taskId = prompt.match(/replyToTaskId=([A-Za-z0-9_-]+)/)?.[1];
        assert.ok(taskId, "Hive's Pi task prompt must include the current task ID");
        toolCall = {
          name: "a2a_reply",
          arguments: { message: "HIVE_PI_A2A_OK", replyToTaskId: taskId },
        };
      } else if (!hasToolResult && prompt.includes("Bonded A2B from pi-a2b-caller")) {
        toolCall = {
          name: "a2a_send",
          arguments: { targetAgent: "pi-a2a-worker", message: "This bonded branch must be rejected." },
        };
        text = "HIVE_PI_A2B_OK";
      } else if (prompt.includes("pi-a2a-worker") && prompt.includes("Use a2a_send exactly once")) {
        if (!hasToolResult && availableTools.includes("a2a_list")) {
          toolCall = { name: "a2a_list", arguments: {} };
        } else {
          toolCall = {
            name: "a2a_send",
            arguments: { targetAgent: "pi-a2a-worker", message: "Use replyToTaskId with your Hive task ID to return HIVE_PI_A2A_OK." },
          };
        }
      } else if (!hasToolResult && prompt.includes("pi-a2b-bonded") && prompt.includes("Use a2b_send exactly once")) {
        toolCall = {
          name: "a2b_send",
          arguments: { targetAgent: "pi-a2b-bonded", message: "Return exactly HIVE_PI_A2B_OK directly." },
        };
        text = "A2B request accepted.";
      } else if (prompt.includes("Bonded A2B from pi-a2b-caller")) {
        text = "HIVE_PI_A2B_OK";
      }
      if (toolCall && !availableTools.includes(toolCall.name)) {
        throw new Error(`Pi did not expose the expected Hive tool ${toolCall.name}`);
      }
      const toolName = toolCall?.name;
      const targetAgent = toolCall?.arguments.targetAgent;
      requests.push({ toolName, targetAgent, prompt });
      writeOpenAIResponse(request, response, body.model || "fixture-model", toolCall, text);
    }).catch((error) => {
      response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: error.message } }));
    });
  });
}

export function writeOpenAIResponse(request, response, model, toolCall, text) {
  const id = `chatcmpl-${randomUUID()}`;
  const choice = toolCall
    ? { role: "assistant", content: null, tool_calls: [{ id: `call-${randomUUID()}`, type: "function", function: {
      name: toolCall.name, arguments: JSON.stringify(toolCall.arguments),
    } }] }
    : { role: "assistant", content: text };
  if (request.body.stream === true) {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const delta = toolCall
      ? { role: "assistant", tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: "function", function: {
        name: toolCall.name, arguments: JSON.stringify(toolCall.arguments),
      } }] }
      : { role: "assistant", content: text };
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model,
      choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model,
      choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    id,
    object: "chat.completion",
    created: 1,
    model,
    choices: [{ index: 0, message: choice, finish_reason: toolCall ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  }));
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  request.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return request.body;
}

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
