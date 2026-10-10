import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { createRuntime } from "../server.js";

test("standalone runtime health, isolated legacy settings and strict malformed-input errors", async (t) => {
  const dataHome = await mkdtemp(join(tmpdir(), "kanban-ts-http-"));
  const runtime = await createRuntime({ dataHome, instance: "test-instance" });
  t.after(async () => {
    await runtime.app.close();
    await rm(dataHome, { recursive: true, force: true });
  });
  const health = await runtime.app.inject({ method: "GET", url: "/health" });
  assert.equal(health.json().instance, "test-instance");
  assert.equal(health.json().runtime, "typescript");
  assert.deepEqual(
    (await runtime.app.inject({ method: "GET", url: "/api/settings" })).json(),
    { version: 1, workspace: { projects: [], historyProjects: [] } },
  );
  const payload = {
    version: 1,
    workspace: { projects: ["/tmp/project"] },
    future: { keep: true },
  };
  assert.equal(
    (
      await runtime.app.inject({
        method: "POST",
        url: "/api/settings",
        payload,
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(
    (await runtime.app.inject({ method: "GET", url: "/api/settings" })).json(),
    payload,
  );
  assert.equal(
    (
      await runtime.app.inject({
        method: "POST",
        url: "/api/settings",
        payload: [],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await runtime.app.inject({ method: "GET", url: "/api/events?since=-1" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await runtime.app.inject({
        method: "GET",
        url: "/api/settings",
        headers: { origin: "https://untrusted.example" },
      })
    ).statusCode,
    403,
  );
});

test("real HTTP SSE replays then delivers live events; disconnect releases the subscription", async (t) => {
  const dataHome = await mkdtemp(join(tmpdir(), "kanban-ts-sse-"));
  const runtime = await createRuntime({ dataHome, instance: "sse-test" });
  const origin = await runtime.app.listen({ port: 0, host: "127.0.0.1" });
  const controller = new AbortController();
  t.after(async () => {
    controller.abort();
    await runtime.app.close();
    await rm(dataHome, { recursive: true, force: true });
  });
  const baselineSubscribers = runtime.hub.subscriberCount;
  runtime.hub.publish("terminal:data", { data: "ignored" });
  runtime.hub.publish("cc-message", { text: "before" });
  const response = await fetch(`${origin}/api/events?since=0&agents=cc`, {
    signal: controller.signal,
  });
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );
  const reader = response.body!.getReader();
  let text = "";
  while (!text.includes('"before"'))
    text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"seq":2/);
  assert.doesNotMatch(text, /ignored/);
  runtime.hub.publish("cc-message", { text: "after" });
  while (!text.includes('"after"'))
    text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"seq":3/);
  controller.abort();
  await reader.cancel().catch(() => undefined);
  for (
    let i = 0;
    i < 100 && runtime.hub.subscriberCount > baselineSubscribers;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runtime.hub.subscriberCount, baselineSubscribers);
});

test("WebSocket serves the same sequence and pending request snapshots as SSE", async (t) => {
  const dataHome = await mkdtemp(join(tmpdir(), "kanban-ts-ws-"));
  const runtime = await createRuntime({ dataHome, instance: "ws-test" });
  const origin = await runtime.app.listen({ port: 0, host: "127.0.0.1" });
  runtime.hub.publish("codex/approval-request", {
    threadId: "t",
    requestId: 1,
    type: "fileChange",
    requestToken: "one",
  });
  const socket = new WebSocket(
    `${origin.replace("http:", "ws:")}/ws?agents=codex`,
  );
  t.after(async () => {
    socket.terminate();
    await runtime.app.close();
    await rm(dataHome, { recursive: true, force: true });
  });
  const message = once(socket, "message");
  await once(socket, "open");
  const [raw] = await message;
  const snapshot = JSON.parse(String(raw));
  assert.equal(snapshot.event, "codex/pending-requests-snapshot");
  assert.equal(snapshot.payload.requests[0].payload.requestToken, "one");
  const next = once(socket, "message");
  runtime.hub.publish("codex:notification", {
    method: "turn/completed",
    params: { threadId: "t", turn: { id: "turn" } },
  });
  assert.equal(JSON.parse(String((await next)[0])).seq, 2);
  socket.close();
  await once(socket, "close");
});
