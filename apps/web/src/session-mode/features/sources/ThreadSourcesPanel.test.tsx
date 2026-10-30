import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { openWorkspaceFileReference } from "@session/services/openWorkspaceFileReference";
import ThreadSourcesPanel from "./ThreadSourcesPanel";
vi.mock("@session/services/openWorkspaceFileReference", () => ({
  openWorkspaceFileReference: vi.fn(async () => true),
}));
vi.mock("./SourceMcpPreview", () => ({
  SourceMcpPreview: () => <p>MCP details</p>,
}));
const events = [
  {
    method: "item/started",
    params: {
      threadId: "owner",
      turnId: "turn",
      item: {
        type: "userMessage",
        id: "user",
        content: [{ type: "text", text: "[source](source.ts:7)" }],
      },
    },
  },
] as unknown as ServerNotification[];
it("opens a file in its source conversation project while another conversation is selected", () => {
  useCodexStore.setState({
    threads: [
      { id: "owner", cwd: "/project" },
      { id: "other", cwd: "/different" },
    ] as never,
    currentThreadId: "other",
  });
  render(
    <main className="session-mode">
      <ThreadSourcesPanel threadId="owner" events={events} onClose={() => {}} />
    </main>,
  );
  fireEvent.click(screen.getByRole("button", { name: "/project/source.ts:7" }));
  expect(openWorkspaceFileReference).toHaveBeenCalledWith(
    expect.objectContaining({ path: "/project/source.ts", line: 7 }),
    "/project",
  );
  expect(useCodexStore.getState().currentThreadId).toBe("other");
});
