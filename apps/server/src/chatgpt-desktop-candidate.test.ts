import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createChatGptDesktopCandidate } from "./chatgpt-desktop-candidate.js";

test("candidate serves only the fixed fourth-mode routes and rejects a foreign WebSocket origin", async (t) => {
  const app = await createChatGptDesktopCandidate({ profileFile: "/tmp/no-candidate-profile/profile.json" });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(async () => app.close());
  const status = await fetch(`${address}/api/chatgpt-desktop/status`);
  assert.ok([200, 503].includes(status.status));
  assert.notEqual((await status.json() as { state: string }).state, "ready");
  assert.equal((await fetch(`${address}/api/agent-sessions`)).status, 404);
  assert.equal((await fetch(`${address}/api/chatgpt-desktop-other/status`)).status, 404);
  const socket = new WebSocket(`${address.replace("http:", "ws:")}/chatgpt-desktop/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000/bridge`, { origin: "https://foreign.invalid" });
  const [, response] = await once(socket, "unexpected-response");
  assert.equal(response.statusCode, 403);
  response.resume();
  socket.on("error", () => {});
  socket.terminate();
});

test("candidate profile path is a fixed canonical absolute server option", async () => {
  for (const profileFile of ["", "relative/profile.json", "/tmp/x/../profile.json", "https://invalid.example/profile"]) {
    await assert.rejects(createChatGptDesktopCandidate({ profileFile }));
  }
});
