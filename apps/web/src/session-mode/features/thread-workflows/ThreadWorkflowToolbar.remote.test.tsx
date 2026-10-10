import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ThreadWorkflowToolbar } from "./ThreadWorkflowToolbar";
import { threadWorkflowActions, useThreadWorkflowActions } from "./actions";
import { useThreadWorkflowStore } from "./delivery";
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("./nativeSearch", async (original) => ({
  ...(await original<typeof import("./nativeSearch")>()),
  searchThreadOccurrences: mocks.search,
}));
vi.mock("./service", () => ({ downloadThreadMarkdown: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh-CN" } }),
}));
const occurrence = {
  turnId: "native-turn",
  itemId: "native-item",
  snippet: "😀 native",
  snippetMatchRange: { start: 3, end: 9 },
  turnCursor: "inclusive-cursor",
};
beforeEach(() => {
  mocks.search
    .mockReset()
    .mockResolvedValue({ data: [occurrence], nextCursor: null });
  useThreadWorkflowActions.setState({
    panels: {},
    requests: {},
    focusRequests: {},
    moveRequests: {},
  });
  useThreadWorkflowStore.setState({ mutations: {}, inlineEdits: {} });
});
it("prepares actual native identity and UTF16 snippet without inventing a virtual row", async () => {
  const prepare = vi.fn().mockResolvedValue({
      rowId: "actual-stable-row",
      itemId: "native-item",
      turnId: "native-turn",
    }),
    navigate = vi.fn();
  render(
    <ThreadWorkflowToolbar
      threadId="owner"
      rows={[]}
      turns={[]}
      onNavigate={navigate}
      onPrepareMatch={prepare}
      historyComplete={false}
    />,
  );
  act(() => threadWorkflowActions.request("owner", "search"));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "native" },
  });
  await screen.findByRole("listitem");
  expect(document.querySelector("mark")?.textContent).toBe("native");
  expect(screen.queryByText(/搜索与导出仅包含/)).toBeNull();
  fireEvent.click(screen.getByRole("listitem"));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "actual-stable-row",
        itemId: "native-item",
        turnId: "native-turn",
        query: "native",
        occurrence: 0,
      }),
    ),
  );
  expect(prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: "owner",
      turnCursor: "inclusive-cursor",
    }),
  );
  expect(prepare.mock.calls[0][0]).not.toHaveProperty("rowId");
});
it("a previous preparation cannot navigate a changed owner/query, and wrong item identity remains explicit", async () => {
  let resolve!: (anchor: unknown) => void;
  const prepare = vi
    .fn()
    .mockImplementationOnce(() => new Promise((done) => (resolve = done)))
    .mockResolvedValue({
      rowId: "wrong-row",
      itemId: "wrong-item",
      turnId: "native-turn",
    });
  const navigate = vi.fn();
  const view = render(
    <ThreadWorkflowToolbar
      threadId="owner"
      rows={[]}
      turns={[]}
      onNavigate={navigate}
      onPrepareMatch={prepare}
    />,
  );
  act(() => threadWorkflowActions.request("owner", "search"));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "native" },
  });
  fireEvent.click(await screen.findByRole("listitem"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "new" } });
  await act(async () =>
    resolve({ rowId: "old-row", itemId: "native-item", turnId: "native-turn" }),
  );
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("listitem"));
  await screen.findByRole("alert");
  expect(navigate).not.toHaveBeenCalled();
  view.rerender(
    <ThreadWorkflowToolbar
      threadId="other-owner"
      rows={[]}
      turns={[]}
      onNavigate={navigate}
      onPrepareMatch={prepare}
    />,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});
