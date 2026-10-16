import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notifyNativeClipboardError } from "@session/features/native-notifications/nativeClipboardError";
import { openWorkspaceFileReference } from "@session/services/openWorkspaceFileReference";
import { clipboardFixture, deferredClipboard } from "@session/test/clipboardFixture";
import { McpToolCallItem } from "./McpToolCallItem";
import { CodexContentOwner } from "../presentation/ownerContext";

vi.mock("@session/contexts/ThemeContext", () => ({ useThemeContext: () => ({ resolvedTheme: "dark" }) }));
vi.mock("@session/services/openWorkspaceFileReference", () => ({ openWorkspaceFileReference: vi.fn() }));
vi.mock("@session/features/native-notifications/nativeClipboardError", () => ({ notifyNativeClipboardError: vi.fn() }));
const uri = "https://example.invalid/resource?literal=%20&citation=fixture";
function item(nextUri = uri) {
  return { id: "mcp-fixture", type: "mcpToolCall", server: "fixture", tool: "inspect", arguments: {}, status: "completed",
    result: { content: [{ type: "resource_link", uri: nextUri, name: "fixture resource" }], structuredContent: null },
    error: null, durationMs: null } as never;
}
let clipboard: ReturnType<typeof clipboardFixture>;
beforeEach(() => { clipboard = clipboardFixture(); vi.clearAllMocks(); });
afterEach(() => clipboard.restore());
async function copy() {
  fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
  fireEvent.click(screen.getByRole("button", { name: "打开方式" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "复制链接" }));
}
it("copies the actual MCP URI using HTTP fallback without opening a resource", async () => {
  render(<McpToolCallItem item={item()} />);
  await copy();
  await waitFor(() => expect(clipboard.texts).toEqual([uri]));
  expect(clipboard.copyEvents).toEqual([expect.objectContaining({ data: { "text/plain": uri }, defaultPrevented: true })]);
  expect(openWorkspaceFileReference).not.toHaveBeenCalled();
  expect(notifyNativeClipboardError).not.toHaveBeenCalled();
});
it("reports false HTTP legacy failure", async () => {
  clipboard.legacy.mockReturnValue(false);
  render(<McpToolCallItem item={item()} />);
  await copy();
  await waitFor(() => expect(notifyNativeClipboardError).toHaveBeenCalled());
});
it("reports a rejected modern write, keeping URI content untouched", async () => {
  const write = deferredClipboard(), writeText = vi.fn(() => write.promise);
  clipboard.modern(writeText);
  render(<McpToolCallItem item={item()} />);
  await copy();
  expect(writeText).toHaveBeenCalledWith(uri);
  expect(notifyNativeClipboardError).not.toHaveBeenCalled();
  await act(async () => write.reject(new Error("denied")));
  await waitFor(() => expect(notifyNativeClipboardError).toHaveBeenCalled());
  expect(clipboard.legacy).not.toHaveBeenCalled();
});
it.each(["uri", "owner", "unmount"])("does not send an old resource's clipboard error after %s changes", async mode => {
  const write = deferredClipboard();
  clipboard.modern(vi.fn(() => write.promise));
  const view = render(<StrictMode><CodexContentOwner.Provider value="resource-owner"><McpToolCallItem item={item()} /></CodexContentOwner.Provider></StrictMode>);
  await copy();
  if (mode === "unmount") view.unmount();
  else view.rerender(<StrictMode><CodexContentOwner.Provider value={mode === "owner" ? "next-owner" : "resource-owner"}><McpToolCallItem item={item(mode === "uri" ? "https://example.invalid/next" : uri)} /></CodexContentOwner.Provider></StrictMode>);
  await act(async () => write.reject(new Error("late denied")));
  expect(notifyNativeClipboardError).not.toHaveBeenCalled();
});

it("finishes a pending resource copy without opening the resource", async () => {
  const write = deferredClipboard(), writeText = vi.fn(() => write.promise);
  clipboard.modern(writeText);
  render(<StrictMode><McpToolCallItem item={item()} /></StrictMode>);
  await copy();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(uri);
  await act(async () => write.resolve());
  expect(openWorkspaceFileReference).not.toHaveBeenCalled();
  expect(notifyNativeClipboardError).not.toHaveBeenCalled();
});
