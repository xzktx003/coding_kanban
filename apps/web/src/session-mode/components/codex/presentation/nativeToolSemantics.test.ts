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
