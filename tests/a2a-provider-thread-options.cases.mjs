import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexAppServerApi } from "../dist/infrastructure/providers/codex/app-server.js";

test("Codex app-server sends ephemeral only when requested", async () => {
  const requests = [];
  const api = new CodexAppServerApi({
    async request(method, params) {
      requests.push({ method, params });
      return {};
    },
  });
  await api.startThread("/project", { ephemeral: true });
  await api.startThread("/project");

  assert.deepEqual(requests, [
    { method: "thread/start", params: { cwd: "/project", ephemeral: true } },
    { method: "thread/start", params: { cwd: "/project" } },
  ]);
});
