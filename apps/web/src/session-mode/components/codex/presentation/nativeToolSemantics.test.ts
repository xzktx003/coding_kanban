import { expect, it } from "vitest";
import nativeMcpSummaryOracle from "./fixtures/nativeMcpSummaryOracle.json";
import {
  nativeMcpToolLabel,
  nativeToolActivityMetadata,
  nativePublicReasoning,
  nativeMcpResultPresentation,
  nativeMcpCompletedSummaryClassification,
  nativeMcpSourcesSummaryLabel,
} from "./nativeToolSemantics";
const tool = (fields = {}) => ({
  type: "mcpToolCall",
  server: "workspace",
  tool: "inspect_repository",
  arguments: {},
  appContext: null,
  status: "completed",
  ...fields,
});
it("matches thirty actual original Ogt/Lt/Ue classifications without inferring tool capabilities", () => {
  expect(nativeMcpSummaryOracle).toHaveLength(30);
  for (const row of nativeMcpSummaryOracle) {
    const actual = nativeMcpCompletedSummaryClassification(row.item, row.apps);
    if (row.presentation)
      expect(actual).toEqual({
        kind: "native",
        key: row.presentation.key,
        presentation: row.presentation,
      });
    else if (row.parts.includes("commands"))
      expect(actual).toEqual({ kind: "command" });
    else if (row.source)
      expect(actual).toMatchObject({ kind: "source", source: row.source });
    else expect(actual).toEqual({ kind: "unnamed" });
  }
});
it("uses actual named MCP sources for completed summaries instead of an unnamed call count", () => {
  expect(
    nativeMcpCompletedSummaryClassification(tool({ server: " fixture " })),
  ).toEqual({
    kind: "source",
    source: { key: "server:fixture", name: "Fixture", preferred: false },
  });
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({ server: "github_mcp_server", pluginId: "public-plugin" }),
    ),
  ).toEqual({
    kind: "source",
    source: {
      key: "server:github_mcp_server",
      name: "GitHub MCP Server",
      preferred: true,
    },
  });
  expect(
    nativeMcpCompletedSummaryClassification(tool({ server: " " })),
  ).toEqual({ kind: "unnamed" });
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({
        server: "fixture",
        appContext: {
          connectorId: "connector_public",
          appName: "Public workspace",
        },
      }),
    ),
  ).toEqual({
    kind: "source",
    source: {
      key: "app:connector_public",
      name: "Public workspace",
      preferred: false,
    },
  });
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({
        server: "fixture",
        appContext: { connectorId: "connector_public", appName: "" },
      }),
    ),
  ).toMatchObject({ kind: "source", source: { name: "" } });
});
it("separates native descriptor calls and native REPL command sources", () => {
  const native = nativeMcpCompletedSummaryClassification(
    tool({
      server: "codex_app",
      tool: "set_thread_archived",
      arguments: { archived: false },
    }),
  );
  expect(native).toMatchObject({
    kind: "native",
    key: "restore_chat:completed",
    presentation: {
      descriptorId: "localConversation.codexTool.restore_chat.state",
      state: "completed",
    },
  });
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({
        server: "codex_app",
        tool: "read_thread",
        error: { message: "failed" },
      }),
    ),
  ).toMatchObject({ kind: "native", key: "read_thread:failed" });
  for (const server of ["node_repl", "cua_repl"])
    expect(nativeMcpCompletedSummaryClassification(tool({ server }))).toEqual({
      kind: "command",
    });
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({
        server: "node_repl",
        appContext: {
          connectorId: "connector_public",
          appName: "Public workspace",
        },
      }),
    ),
  ).toMatchObject({ kind: "source" });
});
it("honors native Lt server and connector gates for first-party MCP descriptors", () => {
  const cloud = tool({ server: "codex_apps", tool: "cloud_threads.read" });
  expect(nativeMcpCompletedSummaryClassification(cloud)).toMatchObject({
    kind: "native",
    key: "cloud_threads.read:completed",
  });
  expect(nativeMcpToolLabel(cloud, "zh", true)).toBe("已读取云端聊天轮次");
  expect(nativeMcpToolLabel(cloud, "en", true, false)).toBe(
    "read cloud chat turn",
  );
  const page = tool({
    server: "pages",
    tool: "manage_page_comment",
    arguments: { action: "react", active: false },
  });
  expect(nativeMcpCompletedSummaryClassification(page)).toMatchObject({
    kind: "native",
    key: "comment_remove_reaction:completed",
  });
  expect(nativeMcpToolLabel(page, "en", true, false)).toBe("removed reaction");
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({
        server: "codex_apps",
        tool: "pages_read_page",
        appContext: { connectorId: "connector_github", appName: "GitHub" },
      }),
    ),
  ).toMatchObject({ kind: "source", source: { key: "app:connector_github" } });
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({ server: "fixture", tool: "read_thread", namespace: "codex_app" }),
    ),
  ).toMatchObject({ kind: "source", source: { key: "server:fixture" } });
});
it("deduplicates native source display names and selects native leading/following integration wording", () => {
  const sources = [
    { key: "server:fixture", name: "Fixture" },
    { key: "server:Fixture", name: "Fixture" },
  ];
  expect(nativeMcpSourcesSummaryLabel(sources, "en")).toBe(
    "Used Fixture integration",
  );
  expect(nativeMcpSourcesSummaryLabel(sources, "en", false)).toBe(
    "used Fixture integration",
  );
  expect(
    nativeMcpSourcesSummaryLabel(
      [...sources, { key: "app:github", name: "GitHub" }],
      "en",
    ),
  ).toBe("Used Fixture and GitHub integrations");
  expect(nativeMcpSourcesSummaryLabel(sources, "zh")).toBe(
    "已使用 Fixture 集成",
  );
  expect(
    nativeMcpSourcesSummaryLabel(
      [{ key: "browser-use", name: "browser-use" }],
      "en",
    ),
  ).toBe("Used the browser");
  expect(
    nativeMcpSourcesSummaryLabel(
      [
        { key: "browser-use", name: "browser-use" },
        { key: "server:fixture", name: "Fixture" },
      ],
      "zh",
    ),
  ).toBe("已使用 浏览器和Fixture");
  expect(nativeMcpSourcesSummaryLabel([], "en")).toBe("");
});
it("resolves only actual provided apps and preserves native source preference", () => {
  const apps = [
    {
      id: "connector_public",
      name: "Actual name",
      pluginDisplayNames: ["public"],
      logoUrl: "https://example.invalid/logo.svg",
    },
  ];
  expect(
    nativeMcpCompletedSummaryClassification(tool({ server: "public" }), apps),
  ).toEqual({
    kind: "source",
    source: {
      key: "app:connector_public",
      name: "Actual name",
      preferred: true,
    },
  });
  expect(
    nativeMcpCompletedSummaryClassification(
      tool({
        server: "public",
        appContext: { connectorId: "different", appName: "Public name" },
      }),
      apps,
    ),
  ).toEqual({
    kind: "source",
    source: { key: "app:different", name: "Public name", preferred: false },
  });
});
it("humanizes unknown tools without leaking connector routing prefixes", () => {
  expect(nativeMcpToolLabel(tool(), "en")).toBe("Inspect repository");
  expect(
    nativeMcpToolLabel(
      tool({
        tool: "gmail_mcp_server_gmail_search_emails",
        appContext: {
          connectorId: "connector_gmail",
          appName: "Gmail",
          actionName: null,
        },
      }),
      "en",
    ),
  ).toBe("Searched emails");
});
it("deduplicates native structured results only for one valid unannotated JSON text block", () => {
  const content = [{ type: "text", text: '{"status":"ready"}' }];
  expect(nativeMcpResultPresentation(content, { status: "ready" })).toEqual({
    content: [],
    structured: { status: "ready" },
  });
  expect(
    nativeMcpResultPresentation(
      [{ ...content[0], annotations: { audience: ["user"] } }],
      { status: "ready" },
    ).content,
  ).toHaveLength(1);
  expect(
    nativeMcpResultPresentation([{ type: "text", text: '{"status":' }], null)
      .content,
  ).toHaveLength(1);
});
it("uses native first party state and argument semantics", () => {
  expect(
    nativeMcpToolLabel(
      tool({
        server: "codex_app",
        tool: "set_thread_archived",
        arguments: { archived: false },
      }),
      "en",
    ),
  ).toBe("Restored chat");
  expect(
    nativeMcpToolLabel(
      tool({
        tool: "js",
        arguments: { title: "  Inspect   weekly results  " },
      }),
      "en",
    ),
  ).toBe("Inspect weekly results");
});
it("retains the existing completion override while selecting native following states", () => {
  const item = tool({ server: "codex_app", tool: "read_thread" });
  expect(nativeMcpToolLabel(item, "en", undefined, false)).toBe("read chat");
  expect(
    nativeMcpToolLabel({ ...item, success: false }, "en", undefined, false),
  ).toBe("couldn’t read chat");
  expect(nativeMcpToolLabel(item, "en", false, false)).toBe("Reading chat");
  expect(nativeMcpToolLabel(tool(), "en", undefined, false)).toBe(
    "inspect repository",
  );
});
it("applies aliases only when the native optional argument schema validates", () => {
  const item = tool({
    server: "codex_app",
    tool: "move_thread_to_sidebar_section",
  });
  expect(
    nativeMcpToolLabel({ ...item, arguments: { sectionId: "pinned" } }, "en"),
  ).toBe("Pinned chat");
  expect(
    nativeMcpToolLabel(
      { ...item, arguments: { sectionId: null } },
      "en",
      undefined,
      false,
    ),
  ).toBe("unpinned chat");
  expect(
    nativeMcpToolLabel(
      {
        ...item,
        tool: "set_thread_archived",
        arguments: { archived: false, pinned: "invalid" },
      },
      "en",
    ),
  ).toBe("Archived chat");
  expect(
    nativeMcpToolLabel(
      { ...item, tool: "automation_update", arguments: { mode: "update" } },
      "en",
    ),
  ).toBe("Updated scheduled task");
  expect(
    nativeMcpToolLabel(
      {
        ...item,
        tool: "open_in_codex",
        arguments: { target: { type: "terminal" } },
      },
      "en",
      undefined,
      false,
    ),
  ).toBe("opened terminal");
});
it("classifies native hidden and standalone records without enabling disabled MCP widgets", () => {
  expect(nativeToolActivityMetadata({ type: "sleep" }).grouping).toBe("hidden");
  expect(
    nativeToolActivityMetadata(
      tool({
        appContext: {
          resourceUri: "ui://tool",
          connectorId: "connector_gmail",
        },
      }),
    ).grouping,
  ).toBe("groupable");
  expect(nativeToolActivityMetadata({ type: "imageView" }).grouping).toBe(
    "standalone",
  );
  expect(
    nativeToolActivityMetadata({
      type: "automaticApprovalReview",
      status: "approved",
    }).grouping,
  ).toBe("hidden");
  expect(
    nativeToolActivityMetadata({
      type: "automaticApprovalReview",
      status: "denied",
    }).grouping,
  ).toBe("standalone");
});
it("strips the native summary heading in both streaming and completed body", () => {
  expect(
    nativePublicReasoning(
      ["**Checking compatibility**\n\nRead the public documentation."],
      true,
    ),
  ).toBe("Read the public documentation.");
  expect(
    nativePublicReasoning(
      ["**Checking compatibility**\n\nRead the public documentation."],
      false,
    ),
  ).toBe("Read the public documentation.");
  expect(nativePublicReasoning(["**Incomplete title"], true)).toBe("");
});
it("honors actual native dynamic registry presentation flags without accepting invented renderer overrides", () => {
  expect(
    nativeToolActivityMetadata({
      type: "dynamicToolCall",
      namespace: "codex_app",
      tool: "update_up_next",
    }).grouping,
  ).toBe("hidden");
  expect(
    nativeToolActivityMetadata({
      type: "dynamicToolCall",
      namespace: "functions",
      tool: "update_up_next",
    }).grouping,
  ).toBe("groupable");
  expect(
    nativeToolActivityMetadata({
      type: "dynamicToolCall",
      namespace: "codex_app",
      tool: "handoff_thread",
    }).grouping,
  ).toBe("standalone");
  expect(
    nativeToolActivityMetadata({
      type: "dynamicToolCall",
      namespace: "codex_app",
      tool: "get_handoff_status",
    }),
  ).toMatchObject({ summaryOnly: true });
});
/**
 * Codex 26.51007.21434 `mcp-tool-call-approval-24a4df1ebe1a.js` exports the
 * predicate
 *
 *   e => e.result?.type === `error` &&
 *        e.result.error === `MCP tool call requires approval, but approval policy is never`
 *
 * and `agent-activity-item-c6d00fb68b13.js` uses it as the grouping decision:
 *
 *   case `mcp-tool-call`:
 *     return $(mr(e), nn(e) || un({item:e, mcpServerStatuses:r})
 *       ? `standalone` : `groupable`);
 *
 * So an MCP call the agent could not run because `approvals: never` blocks it
 * is pulled out of the collapsed activity group and shown on its own row — the
 * user has to see that the run stalled on a policy they can change, not find it
 * folded into "used 3 tools".
 *
 * The message is real upstream text, not VSIX-only: `@openai/codex` 0.164.0's
 * `codex-linux-x64` binary carries it verbatim next to `mcp_tool_call_approval`.
 * Our runtime surfaces it as `item.error.message` (binding `McpToolCallError`
 * is `{ message: string }`), where the extension reads `result.error`, so the
 * predicate matches on our own shape.
 */
it("pulls an approval-blocked MCP call out of the activity group", () => {
  const blocked = tool({
    status: "failed",
    error: {
      message: "MCP tool call requires approval, but approval policy is never",
    },
  });
  expect(nativeToolActivityMetadata(blocked).grouping).toBe("standalone");
  // Every other MCP failure stays grouped: only the policy block is promoted.
  expect(
    nativeToolActivityMetadata(
      tool({ status: "failed", error: { message: "connection refused" } }),
    ).grouping,
  ).toBe("groupable");
  expect(nativeToolActivityMetadata(tool()).grouping).toBe("groupable");
});
/**
 * Codex 26.51007.21434 picks a page-tool label from a three-state table, and
 * the third state exists because the label is reused in two grammatical
 * positions (`mcp-tool-activity-label-f3c34b9a3514.js`):
 *
 *   function ht({tool:e,toolArguments:t,completed:n,isLeadingSummaryPart:r=!0}){
 *     … return i==null?null:n?r?i.completed:i.completedFollowing:i.active }
 *
 * `isLeadingSummaryPart` defaults to true: a leading part gets the capitalized
 * standalone form ("Read artifact"), while a part following another activity in
 * the same summary gets the lowercase continuation ("read artifact"). Only
 * `pageToolActivity` carries `completedFollowing` — `mcpToolActivity` has just
 * `active`/`completed`, so the distinction applies to the Pages tools alone.
 *
 * Six page tools are outside `nativePageCodexToolNames` and so resolve through
 * the `pageToolActivity.*` key lookup rather than a registered descriptor;
 * those are the ones that can lose the continuation form.
 */
it("uses the continuation form for a page tool that follows another activity", () => {
  const artifact = tool({ server: "pages", tool: "read_artifact" });
  expect(nativeMcpToolLabel(artifact, "en", true)).toBe("Read artifact");
  expect(nativeMcpToolLabel(artifact, "en", true, false)).toBe("read artifact");
  // Still the active form while running, in either position.
  expect(nativeMcpToolLabel(artifact, "en", false, false)).toBe(
    "Connecting artifact",
  );
  const space = tool({ server: "codex_apps", tool: "pages_get_space" });
  expect(nativeMcpToolLabel(space, "en", true)).toBe("Read space");
  expect(nativeMcpToolLabel(space, "en", true, false)).toBe("read space");
});
