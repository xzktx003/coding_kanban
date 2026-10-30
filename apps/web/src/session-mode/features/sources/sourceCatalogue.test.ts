import { expect, it } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { buildSourceCatalogue } from "./sourceCatalogue";
const item = (
  id: string,
  data: object,
  method = "item/completed",
  threadId = "owner",
) =>
  ({
    method,
    params: { threadId, turnId: "turn", item: { id, ...data } },
  }) as unknown as ServerNotification;
it("groups sites by host, files by use, and MCP sources with deduplicated call identities", () => {
  const events = [
    item(
      "user",
      {
        type: "userMessage",
        content: [{ type: "mention", name: "file", path: "/project/input.ts" }],
      },
      "item/started",
    ),
    item("read", {
      type: "commandExecution",
      commandActions: [{ type: "read", path: "/project/input.ts" }],
    }),
    item("patch", {
      type: "fileChange",
      status: "completed",
      changes: [
        { path: "/project/new.ts", kind: { type: "add" }, diff: "huge" },
        {
          path: "/project/input.ts",
          kind: { type: "update", move_path: null },
        },
      ],
    }),
    item("web", {
      type: "webSearch",
      action: { type: "openPage", url: "https://example.org/one" },
    }),
    item("web2", {
      type: "webSearch",
      action: { type: "openPage", url: "https://example.org/two" },
    }),
    item(
      "mcp",
      {
        type: "mcpToolCall",
        server: "docs",
        tool: "lookup",
        arguments: { secret: "not copied" },
        result: { content: ["large"] },
      },
      "item/started",
    ),
    item("mcp", {
      type: "mcpToolCall",
      server: "docs",
      tool: "lookup",
      arguments: { secret: "not copied" },
      result: { content: ["large"] },
    }),
    item(
      "foreign",
      {
        type: "fileChange",
        status: "completed",
        changes: [{ path: "/other/file", kind: { type: "add" } }],
      },
      "item/completed",
      "other",
    ),
  ];
  const catalogue = buildSourceCatalogue(events, "owner");
  expect(catalogue.web).toHaveLength(1);
  expect(catalogue.web[0]).toMatchObject({
    host: "example.org",
    urls: ["https://example.org/one", "https://example.org/two"],
  });
  expect(
    catalogue.files.find((file) => file.path === "/project/input.ts")?.roles,
  ).toEqual(["provided", "read", "updated"]);
  expect(
    catalogue.files.find((file) => file.path === "/project/new.ts")?.roles,
  ).toEqual(["created"]);
  expect(catalogue.mcp[0]).toMatchObject({
    server: "docs",
    count: 1,
    calls: [
      { threadId: "owner", turnId: "turn", itemId: "mcp", tool: "lookup" },
    ],
  });
  expect(JSON.stringify(catalogue)).not.toContain("not copied");
  expect(JSON.stringify(catalogue)).not.toContain("huge");
  expect(JSON.stringify(catalogue)).not.toContain("/other/file");
});
it("does not claim failed patches changed files, and rejects unsafe URLs and paths", () => {
  const catalogue = buildSourceCatalogue(
    [
      item("failed", {
        type: "fileChange",
        status: "failed",
        changes: [{ path: "/project/failed", kind: { type: "add" } }],
      }),
      item("unsafe", {
        type: "webSearch",
        action: { type: "openPage", url: "javascript:alert(1)" },
      }),
      item("credentials", {
        type: "webSearch",
        action: { type: "openPage", url: "https://secret:token@example.org/" },
      }),
      item("bad-path", {
        type: "userMessage",
        content: [{ type: "mention", path: "/project/\u0000bad" }],
      }),
    ],
    "owner",
  );
  expect(catalogue.files).toEqual([]);
  expect(catalogue.web).toEqual([]);
});
it("bounds source metadata while making truncation explicit", () => {
  const events = Array.from({ length: 600 }, (_, index) =>
    item(String(index), {
      type: "webSearch",
      action: { type: "openPage", url: `https://site${index}.example/` },
    }),
  );
  const catalogue = buildSourceCatalogue(events, "owner");
  expect(catalogue.web.length).toBeLessThanOrEqual(512);
  expect(catalogue.truncated).toBe(true);
});

it("retains literal native filename colons and extracts Markdown and native citation locations separately", () => {
  const catalogue = buildSourceCatalogue(
    [
      item(
        "literal",
        {
          type: "userMessage",
          content: [{ type: "mention", path: "/project/literal.ts:7" }],
        },
        "item/started",
      ),
      item("answer", {
        type: "agentMessage",
        text: '[source](source.ts:8:2) [web](https://docs.example.org/ref) :codex-file-citation{path="/project/cited.py" line_range_start="12"}',
      }),
      item("results", {
        type: "webSearch",
        action: { type: "search" },
        results: [
          {
            url: "https://docs.example.org/result",
            content: "not copied into sources",
          },
        ],
      }),
    ],
    "owner",
    "/project",
  );
  expect(
    catalogue.files.find((source) => source.path === "/project/literal.ts:7")
      ?.line,
  ).toBeUndefined();
  expect(
    catalogue.files.find((source) => source.path === "/project/source.ts"),
  ).toMatchObject({ line: 8, column: 2 });
  expect(
    catalogue.files.find((source) => source.path === "/project/cited.py"),
  ).toMatchObject({ line: 12 });
  expect(catalogue.web[0].urls).toEqual([
    "https://docs.example.org/ref",
    "https://docs.example.org/result",
  ]);
  expect(JSON.stringify(catalogue)).not.toContain("not copied into sources");
});
