import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import { NativeModelSelector } from "./NativeModelSelector";
import { useLayoutStore } from "@session/stores/useLayoutStore";
const calls = vi.hoisted(() => ({
  model: vi.fn(),
  effort: vi.fn(),
  effortValue: "high",
  options: ["low", "medium", "high"],
  currentThreadId: "original" as string | null,
}));
beforeEach(() => {
  calls.effortValue = "high";
  calls.options = ["low", "medium", "high"];
  calls.currentThreadId = "original";
  useLayoutStore.setState({ view: "agent" });
});
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ currentThreadId: calls.currentThreadId }),
    { getState: () => ({ currentThreadId: calls.currentThreadId }) },
  ),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "model-one",
    modelProvider: "openai",
    reasoningEffort: calls.effortValue,
    setModel: calls.model,
    setReasoningEffort: calls.effort,
  }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    loading: false,
    error: null,
    reload: vi.fn(),
    providerItems: () => [
      { id: "model-one", label: "原生模型一" },
      { id: "model-two", label: "原生模型二" },
    ],
    openAiModels: [
      {
        id: "model-one",
        model: "model-one",
        displayName: "原生模型一",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: calls.options.map((reasoningEffort) => ({
          reasoningEffort,
        })),
      },
      {
        id: "model-two",
        model: "model-two",
        displayName: "原生模型二",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
      },
    ],
  }),
}));
it("uses native simple power view and switches to native radio model rows without losing supported effort", async () => {
  render(<NativeModelSelector threadId="original" />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
  });
  expect(await screen.findByRole("menuitem", { name: "强度" })).toBeDefined();
  expect(
    screen.getByRole("menuitem", { name: "选择模型" }).textContent,
  ).toContain("高");
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "强度" }), {
    key: "ArrowLeft",
  });
  expect(calls.effort).toHaveBeenCalledWith("medium");
  fireEvent.click(screen.getByRole("menuitem", { name: "选择模型" }));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: "原生模型二" }),
  );
  expect(calls.model).toHaveBeenCalledWith("model-two");
  expect(calls.effort).not.toHaveBeenCalledWith("low");
});

it("matches native pointer view changes by focusing the menu container", async () => {
  render(<NativeModelSelector threadId="original" />);
  fireEvent.pointerDown(screen.getByRole("button", { name: /^模型：/ }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  await screen.findByRole("menuitem", { name: "强度" });
  fireEvent.click(screen.getByRole("menuitem", { name: "选择模型" }));
  await screen.findByRole("menuitemradio", { name: "原生模型一" });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("menu")),
  );
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemradio", { name: "原生模型一" }),
    ),
  );
});

it("uses the actual native 28px thumb minus 1px endpoint inset for ticks and input", async () => {
  render(<NativeModelSelector threadId="original" />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
    key: "ArrowDown",
  });
  const thumb = await screen.findByRole("menuitem", { name: "强度" });
  expect(thumb.style.left).toBe("calc(187px)");
  const dots = document.querySelectorAll<HTMLElement>(
    ".session-native-power-dot",
  );
  expect([...dots].map((dot) => dot.style.left)).toEqual([
    "13px",
    "100px",
    "187px",
  ]);
});

it.each(["high", "xhigh", "ultra"])(
  "uses native explicit-model accent and only supported ultra maximum metadata (%s)",
  async (effort) => {
    calls.options = ["low", "medium", "high", "xhigh", "ultra"];
    calls.effortValue = effort;
    render(<NativeModelSelector threadId="original" />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
      key: "ArrowDown",
    });
    await screen.findByRole("menuitem", { name: "强度" });
    const label = document.querySelector(".session-native-power-effort")!;
    expect(label.getAttribute("data-accent")).toBe("true");
    expect(label.getAttribute("data-maximum")).toBe(String(effort === "ultra"));
  },
);

function renderComposerModelMenu(expanded = false) {
  const view = render(
    <div className="session-mode">
      <section
        className={
          expanded ? "session-composer-sheet is-full" : "session-codex-composer"
        }
        data-draft-owner={expanded ? undefined : "codex:original"}
      >
        {expanded ? (
          <div className="session-rich-draft">
            <textarea aria-label="原会话草稿" />
          </div>
        ) : (
          <div className="session-native-editor-slot">
            <div
              tabIndex={0}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="原会话草稿"
            />
          </div>
        )}
        <NativeModelSelector threadId="original" draftOwner="codex:original" />
      </section>
    </div>,
  );
  const editor = screen.getByRole("textbox", { name: "原会话草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  return {
    ...view,
    editor,
    trigger: screen.getByRole("button", { name: /^模型：/ }),
  };
}

async function openComposerModelMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("menuitem", { name: "强度" });
  const menu = screen.getByRole("menu");
  menu.focus();
  return menu;
}

it.each([false, true])(
  "returns Escape to the actual %s expanded composer instead of the model trigger",
  async (expanded) => {
    const { editor, trigger } = renderComposerModelMenu(expanded);
    const menu = await openComposerModelMenu(trigger);
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editor));
  },
);

it.each(["owner", "thread", "page", "mode", "inert", "detached"])(
  "does not restore stale composer or trigger focus after an Escape with changed %s scope",
  async (changed) => {
    const { editor, trigger } = renderComposerModelMenu();
    const menu = await openComposerModelMenu(trigger);
    const root = editor.closest<HTMLElement>(".session-codex-composer")!;
    if (changed === "owner") root.dataset.draftOwner = "codex:other";
    if (changed === "thread") calls.currentThreadId = "other";
    if (changed === "page") useLayoutStore.setState({ view: "settings" });
    if (changed === "mode")
      root.closest<HTMLElement>(".session-mode")!.hidden = true;
    if (changed === "inert") root.setAttribute("inert", "");
    if (changed === "detached") editor.remove();
    const editorFocus = vi.spyOn(editor, "focus");
    const triggerFocus = vi.spyOn(trigger, "focus");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    expect(editorFocus).not.toHaveBeenCalled();
    expect(triggerFocus).not.toHaveBeenCalled();
  },
);

it("preserves pointer dismissal without moving focus into the composer", async () => {
  const { editor, trigger } = renderComposerModelMenu();
  await openComposerModelMenu(trigger);
  const editorFocus = vi.spyOn(editor, "focus");
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(editorFocus).not.toHaveBeenCalled();
});

it("rejects a replaced expanded draft owner even when both targets are new chats", async () => {
  calls.currentThreadId = null;
  const composer = (owner: string) => (
    <div className="session-mode">
      <section className="session-composer-sheet is-full">
        <div className="session-rich-draft">
          <textarea aria-label="展开草稿" />
        </div>
        <NativeModelSelector threadId={null} draftOwner={owner} />
      </section>
    </div>
  );
  const view = render(composer("codex:new:first"));
  const editor = screen.getByRole("textbox", { name: "展开草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  const trigger = screen.getByRole("button", { name: /^模型：/ });
  const menu = await openComposerModelMenu(trigger);
  view.rerender(composer("codex:new:second"));
  const editorFocus = vi.spyOn(editor, "focus");
  const triggerFocus = vi.spyOn(trigger, "focus");
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(editorFocus).not.toHaveBeenCalled();
  expect(triggerFocus).not.toHaveBeenCalled();
});
