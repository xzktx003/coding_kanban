import { expect, it } from "vitest";
import { nativeMcpToolLabel } from "./nativeToolSemantics";
it("uses real named connector invocation context and native truncation instead of dropping it from the activity label", () => {
  expect(
    nativeMcpToolLabel(
      {
        server: "github",
        tool: "create_issue",
        appContext: { connectorId: "connector_github", appName: "GitHub" },
        arguments: { title: "Public issue title" },
        status: "inProgress",
      },
      "en",
    ),
  ).toBe('Creating issue "Public issue title"');
  expect(
    nativeMcpToolLabel(
      {
        server: "github",
        tool: "create_issue",
        appContext: { connectorId: "connector_github", appName: "GitHub" },
        arguments: { title: 42 },
        status: "inProgress",
      },
      "en",
    ),
  ).toBe("Creating issue");
});
it("only counts public structured results when the native tool result succeeded", () => {
  const item = {
    server: "gmail",
    tool: "read_email_thread",
    appContext: { connectorId: "connector_gmail", appName: "Gmail" },
    arguments: {},
    result: {
      structuredContent: {
        results: [{ id: "one" }, { id: "two" }, { id: "three" }],
      },
    },
    status: "completed",
  };
  expect(nativeMcpToolLabel(item, "en")).toBe("Read 3 thread emails");
  expect(
    nativeMcpToolLabel(
      { ...item, status: "failed", error: { message: "Native tool failed" } },
      "en",
    ),
  ).toBe("Read thread emails");
});
