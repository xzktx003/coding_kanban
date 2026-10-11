import test from "node:test";
import assert from "node:assert/strict";
import { nativeSlackTarget } from "@agent-orchestrator/shared";
import {
  SlackPreviewService,
  selectSlackPreviewTool,
} from "./slack-preview.js";
import { object, type Json } from "../core/json.js";
const profileHref = "https://team.slack.com/team/U123";
const tool = (action = "slack_read_user_profile") => ({
  name: "slack_tool",
  _meta: {
    connector_name: "Slack",
    connectorId: "slack",
    _codex_apps: { resource_uri: `/slack/workspace/${action}` },
  },
});
const status = (value = tool()) => [
  { name: "codex_apps", tools: { slack_tool: value } },
];
const output = {
  content: [
    {
      type: "text",
      text: JSON.stringify({ result: "User ID: U123\nReal Name: Alice" }),
    },
  ],
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function fixture() {
  const state = {
    account: "a",
    routed: true,
    tools: status(),
    response: async (): Promise<Json> => output,
    clock: 0,
    starts: 0,
  };
  const calls: { method: string; params: Json }[] = [];
  const service = new SlackPreviewService(
    async (method, params): Promise<Json> => {
      calls.push({ method, params });
      if (method === "account/read")
        return {
          account: { type: "chatgpt", email: "fixture@example.invalid" },
          workspaceRouting: state.routed
            ? {
                chatgptAccountId: state.account,
                backendOrigin: "https://example.invalid",
                accountRoutingOverride: "NO_CONSTRAINT",
              }
            : null,
        };
      if (method === "mcpServerStatus/list")
        return { data: state.tools, nextCursor: null };
      if (method === "thread/start")
        return { thread: { id: `preview-${++state.starts}` } };
      if (method === "mcpServer/tool/call") return state.response();
      if (method === "thread/unsubscribe") return {};
      throw new Error("Unexpected method " + method);
    },
    "test-instance",
    () => state.clock,
  );
  const context = async (href = profileHref) =>
    object(object(await service.context(href)).context);
  return { state, calls, service, context };
}
test("account or directory errors do not expose raw diagnostic bodies through the preview API", async (t) => {
  const service = new SlackPreviewService(async () => {
    throw new Error("PRIVATE_DIAGNOSTIC_".repeat(1000));
  }, "diagnostic-fixture");
  t.after(() => service.close());
  assert.deepEqual(await service.context(profileHref), { context: null });
});
test("only a unique exact Slack target tool is trusted, including both connector aliases", () => {
  const target = nativeSlackTarget(profileHref)!;
  assert.equal(selectSlackPreviewTool(status(), target)?.tool, "slack_tool");
  const alias: any = tool();
  delete alias._meta.connectorId;
  alias._meta.connector_id = "slack";
  assert.equal(
    selectSlackPreviewTool(status(alias), target)?.connectorId,
    "slack",
  );
  for (const mutation of [
    (t: any) => (t._meta._codex_apps.synthetic_link = true),
    (t: any) => (t._meta._codex_apps.synthetic_link = null),
    (t: any) => (t._meta.connector_id = 4),
    (t: any) => (t._meta.connectorId = null),
    (t: any) => (t._meta.connectorId = " "),
    (t: any) => (t._meta.link_id = 4),
    (t: any) =>
      (t._meta._codex_apps.resource_uri =
        "/other/workspace/slack_read_user_profile"),
    (t: any) => (t._meta._codex_apps.resource_uri += "/extra"),
  ]) {
    const value = tool();
    mutation(value);
    assert.equal(selectSlackPreviewTool(status(value), target), null);
  }
  assert.equal(
    selectSlackPreviewTool([...status(), ...status()], target),
    null,
  );
  assert.equal(
    selectSlackPreviewTool(
      [{ ...status()[0], name: "arbitrary_server" }],
      target,
    ),
    null,
  );
});
test("missing authoritative account routing never starts a thread or calls a tool", async (t) => {
  const f = fixture();
  t.after(() => f.service.close());
  f.state.routed = false;
  assert.deepEqual(await f.service.context(profileHref), { context: null });
  assert(
    !f.calls.some(
      (c) => c.method === "thread/start" || c.method === "mcpServer/tool/call",
    ),
  );
});
test("account change discards a late result and defers only its own unsubscribe until the call settles", async (t) => {
  const f = fixture();
  t.after(() => f.service.close());
  const reply = deferred<Json>(),
    sent = deferred<void>();
  f.state.response = () => {
    sent.resolve();
    return reply.promise;
  };
  const scope = await f.context(),
    work = f.service.read(profileHref, scope.token);
  await sent.promise;
  f.state.account = "b";
  f.service.observe("account/updated");
  await Promise.resolve();
  await Promise.resolve();
  assert(!f.calls.some((c) => c.method === "thread/unsubscribe"));
  reply.resolve(output);
  assert.deepEqual(object(await work).data, { status: "unavailable" });
  await Promise.resolve();
  assert.deepEqual(
    f.calls
      .filter((c) => c.method === "thread/unsubscribe")
      .map((c) => c.params),
    [{ threadId: "preview-1" }],
  );
  f.state.response = async () => output;
  const next = await f.context();
  await f.service.read(profileHref, next.token);
  assert.equal(f.state.starts, 2);
  assert(
    !f.calls.some((c) =>
      /^(?:turn\/|thread\/(?:resume|delete|rollback))/u.test(c.method),
    ),
  );
});
test("concurrent reads coalesce, reuse their host, and cache unavailable responses for one minute", async (t) => {
  const f = fixture();
  t.after(() => f.service.close());
  const reply = deferred<Json>(),
    sent = deferred<void>();
  f.state.response = () => {
    sent.resolve();
    return reply.promise;
  };
  const [a, b] = await Promise.all([f.context(), f.context()]);
  const first = f.service.read(profileHref, a.token),
    second = f.service.read(profileHref, b.token);
  await sent.promise;
  reply.resolve({ isError: true, content: [] });
  await Promise.all([first, second]);
  assert.equal(
    f.calls.filter((c) => c.method === "mcpServer/tool/call").length,
    1,
  );
  await f.service.read(profileHref, a.token);
  assert.equal(
    f.calls.filter((c) => c.method === "mcpServer/tool/call").length,
    1,
  );
  f.state.clock = 60_001;
  f.state.response = async () => output;
  assert.equal(
    object(object(await f.service.read(profileHref, a.token)).data).status,
    "ready",
  );
  assert.equal(
    f.calls.filter((c) => c.method === "mcpServer/tool/call").length,
    2,
  );
  assert.equal(f.state.starts, 1);
});
test("changed directory and a forged target are rejected before any tool dispatch", async (t) => {
  const f = fixture();
  t.after(() => f.service.close());
  const scope = await f.context();
  await assert.rejects(
    f.service.read("https://team.slack.com/team/U456", scope.token),
    /target changed/u,
  );
  f.state.tools[0].tools.slack_tool._meta._codex_apps.resource_uri =
    "/slack/changed/slack_read_user_profile";
  await assert.rejects(
    f.service.read(profileHref, scope.token),
    /connection changed/u,
  );
  assert.equal(f.state.starts, 0);
});
test("message previews read the root with 1 or 100 entries and select the exact reply", async (t) => {
  const f = fixture();
  t.after(() => f.service.close());
  f.state.tools = status(tool("slack_read_thread"));
  f.state.response = async () => ({
    structuredContent: {
      slack_data: {
        schema_version: 1,
        ok: true,
        channel_id: "C123",
        message_ts: "1700000000.000000",
        messages: [
          { ts: "1700000000.000000", text: "root" },
          { ts: "1700000000.000001", text: "reply" },
        ],
      },
    },
  });
  for (const [suffix, expected, limit] of [
    ["0", "root", 1],
    ["1?thread_ts=1700000000.000000", "reply", 100],
  ] as const) {
    const href =
        "https://team.slack.com/archives/C123/p170000000000000" + suffix,
      scope = await f.context(href);
    assert.equal(
      object(object(await f.service.read(href, scope.token)).data).description,
      expected,
    );
    assert.deepEqual(
      object(
        f.calls.filter((c) => c.method === "mcpServer/tool/call").at(-1)!
          .params,
      ).arguments,
      {
        channel_id: "C123",
        message_ts: "1700000000.000000",
        limit,
        response_format: "concise",
        include_structured_content: true,
      },
    );
  }
});
