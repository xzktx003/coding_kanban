import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeModelSelector } from "./NativeModelSelector";
import { ComposerSheet } from "./v2/ComposerSheet";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@session/components/ui/dialog";

vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: Object.assign(
    (select: (value: unknown) => unknown) =>
      select({ currentThreadId: "pointer-owner" }),
    { getState: () => ({ currentThreadId: "pointer-owner" }) },
  ),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "pointer-model",
    modelProvider: "openai",
    reasoningEffort: "high",
    serviceTier: null,
    setModel: vi.fn(),
    setReasoningEffort: vi.fn(),
    setServiceTier: vi.fn(),
  }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    loading: false,
    error: null,
    reload: vi.fn(),
    providerItems: () => [{ id: "pointer-model", label: "当前模型" }],
    openAiModels: [
      {
        id: "pointer-model",
        model: "pointer-model",
        displayName: "当前模型",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high"].map(
          (reasoningEffort) => ({ reasoningEffort }),
        ),
      },
    ],
  }),
}));

let previousPointerEvents: string;
beforeEach(() => {
  useLayoutStore.setState({ view: "agent" });
  previousPointerEvents = document.body.style.pointerEvents;
  document.body.style.pointerEvents = "auto";
  const nativeComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = nativeComputedStyle(element, pseudo);
    if (element.matches(".session-native-model-menu")) {
      // Browser computed styles are live; jsdom returns a snapshot. Keep the
      // actual Presence hook alive for the same enter -> exit transition.
      Object.defineProperty(style, "animationName", {
        configurable: true,
        get: () =>
          element.getAttribute("data-state") === "open" ? "enter" : "exit",
      });
    }
    return style;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.pointerEvents = previousPointerEvents;
});

function sheet(shown: boolean, otherModal = false) {
  return (
    <div className="session-mode">
      <button type="button">普通页面操作</button>
      {otherModal && (
        <Dialog open>
          <DialogContent>
            <DialogTitle>另一个真实模态面板</DialogTitle>
          </DialogContent>
        </Dialog>
      )}
      {shown && (
        <ComposerSheet
          full
          title="展开编辑"
          onClose={vi.fn()}
          footer={
            <NativeModelSelector
              threadId="pointer-owner"
              draftOwner="pointer-draft"
            />
          }
        >
          <div className="session-rich-draft">
            <textarea aria-label="未发送草稿" defaultValue="保留原草稿" />
          </div>
        </ComposerSheet>
      )}
    </div>
  );
}

async function openModelMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitem", { name: "选择模型" }));
  await screen.findByRole("menuitemradio", { name: "当前模型" });
  await waitFor(() => expect(document.body.style.pointerEvents).toBe("none"));
  return menu;
}

it("restores pointer input when the sheet unmounts with its model menu still open", async () => {
  const { rerender } = render(sheet(false));
  rerender(sheet(true));
  await openModelMenu();
  rerender(sheet(false));
  await waitFor(() => expect(document.body.style.pointerEvents).toBe("auto"));
});

it("keeps the sheet modal, then restores pointer input when the sheet unmounts during model-menu exit", async () => {
  const { rerender } = render(sheet(false));
  rerender(sheet(true));
  const menu = await openModelMenu();
  fireEvent.keyDown(menu, { key: "Escape" });
  // Closing the nested menu must keep its containing Sheet protected.
  expect(
    document.querySelector('[role="dialog"].session-composer-sheet.is-full'),
  ).not.toBeNull();
  expect(document.body.style.pointerEvents).toBe("none");
  rerender(sheet(false));
  await waitFor(() => expect(document.body.style.pointerEvents).toBe("auto"));
});

it("keeps another actual Dialog locked until its own final owner unmounts", async () => {
  const { rerender } = render(sheet(false));
  rerender(sheet(false, true));
  rerender(sheet(true, true));
  const menu = await openModelMenu();
  fireEvent.keyDown(menu, { key: "Escape" });
  rerender(sheet(false, true));
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.body.style.pointerEvents).toBe("none");
  rerender(sheet(false));
  await waitFor(() => expect(document.body.style.pointerEvents).toBe("auto"));
});

it.each([false, true])(
  "keeps the reopened layer's captured draft when an older focus cleanup runs (already closed: %s)",
  async (alreadyClosed) => {
    const { rerender } = render(sheet(false));
    rerender(sheet(true));
    const editor = screen.getByRole("textbox", { name: "未发送草稿" });
    vi.spyOn(editor, "getClientRects").mockReturnValue({
      length: 1,
    } as DOMRectList);
    const trigger = screen.getByRole("button", { name: /^模型：/ });
    const menu = await openModelMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const reopened = await screen.findByRole("menu");
    if (alreadyClosed) fireEvent.keyDown(reopened, { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (!alreadyClosed) fireEvent.keyDown(reopened, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
  },
);
