import test from "node:test";
import assert from "node:assert/strict";
import {
  GithubPreviewService,
  selectGithubPreviewTool,
} from "./github-preview.js";
import { object, type Json } from "../core/json.js";
const href = "https://github.com/OpenAI/Codex/pull/42";
const tool = (action = "get_pr_info", link = "primary") => ({
  name: `github.${action}`,
  _meta: {
    connector_name: "GitHub",
    connectorId: "github",
    _codex_apps: { resource_uri: `/github/${link}/${action}` },
  },
});
const directory = (fetch = false): Json[] => [
  {
    name: "codex_apps",
    tools: {
      "github.get_pr_info": tool(),
      ...(fetch ? { "github.fetch": tool("fetch") } : {}),
    },
  },
];
test("selects the native info tool, prefers fetch only for the same GitHub target", () => {
  assert.equal(selectGithubPreviewTool(directory())?.mode, "info");
  assert.equal(selectGithubPreviewTool(directory(true))?.mode, "fetch");
  const entries = directory(true);
  object(object(entries[0]).tools)["github.fetch"] = tool("fetch", "other");
  assert.equal(selectGithubPreviewTool(entries)?.mode, "info");
  object(object(entries[0]).tools)["github.get_pr_info"] = {
    ...tool(),
    _meta: {
      ...tool()._meta,
      _codex_apps: {
        resource_uri: "/github/primary/get_pr_info",
        synthetic_link: true,
      },
    },
  };
  assert.equal(selectGithubPreviewTool(entries), null);
});
test("passes an explicit account link only when the native metadata requires it", () => {
  const entries = directory();
  const meta = object(
    object(object(entries[0]).tools)["github.get_pr_info"],
  )._meta;
  object(object(meta)._codex_apps).requires_explicit_link_id = true;
  assert.equal(selectGithubPreviewTool(entries)?.explicitLink, true);
});
for (const fetch of [false, true])
  test(`read-only PR transport (${fetch ? "preferred fetch" : "info fallback"}) validates and caches copied data`, async (t) => {
    const calls: { method: string; params: Json }[] = [];
    const info = {
      base: "main",
      head: "fix",
      draft: false,
      merged: true,
      number: 42,
      state: "closed",
      title: "Fix routing",
      url: href,
      body: "x".repeat(200000),
    };
    const service = new GithubPreviewService(
      async (method, params): Promise<Json> => {
        calls.push({ method, params });
        if (method === "account/read")
          return {
            account: { type: "chatgpt", email: "fixture@example.invalid" },
            workspaceRouting: {
              chatgptAccountId: "fixture",
              backendOrigin: "https://example.invalid",
              accountRoutingOverride: "NO_CONSTRAINT",
            },
          };
        if (method === "mcpServerStatus/list")
          return { data: directory(fetch), nextCursor: null };
        if (method === "thread/start")
          return { thread: { id: "private-github-host" } };
        if (method === "thread/unsubscribe") return {};
        if (method === "mcpServer/tool/call")
          return {
            structuredContent: fetch
              ? {
                  content: JSON.stringify({
                    ...info,
                    base: { ref: "main" },
                    head: { ref: "fix", sha: "abc", repo: null },
                    html_url: href,
                  }),
                }
              : info,
          };
        throw new Error(method);
      },
      "github-fixture",
    );
    t.after(() => service.close());
    const context = object(object(await service.context(href)).context);
    const result = await service.read(href, context.token);
    assert.deepEqual(result.data, { title: "Fix routing", status: "merged" });
    assert.ok(JSON.stringify(result).length < 200);
    await service.read(href, context.token);
    const reads = calls.filter((c) => c.method === "mcpServer/tool/call");
    assert.equal(reads.length, 1);
    assert.deepEqual(
      object(reads[0].params).arguments,
      fetch
        ? { url: "https://api.github.com/repos/openai/codex/pulls/42" }
        : { pr_number: 42, repository_full_name: "openai/codex" },
    );
    assert.deepEqual(calls.find((c) => c.method === "thread/start")?.params, {
      ephemeral: true,
      permissions: ":read-only",
      threadSource: "mcp_extension_host",
    });
    assert.equal(
      calls.some((c) => c.method === "turn/start"),
      false,
    );
    await assert.rejects(
      service.read("https://github.com/OpenAI/Codex/pull/43", context.token),
      /target changed/,
    );
  });
