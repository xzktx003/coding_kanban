import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeModelSelector } from "./NativeModelSelector";
import { useLayoutStore } from "@session/stores/useLayoutStore";

const state = vi.hoisted(() => ({
  thread: "first" as string | null,
  effortValue: "high",
  effort: vi.fn(),
  model: vi.fn(),
  serviceTier: vi.fn(),
  submit: vi.fn(),
  bubble: vi.fn(),
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: Object.assign(
    (select: (value: unknown) => unknown) =>
      select({ currentThreadId: state.thread }),
    { getState: () => ({ currentThreadId: state.thread }) },
  ),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    model: "selected-model",
    modelProvider: "openai",
    reasoningEffort: state.effortValue,
    serviceTier: null,
    setModel: state.model,
    setReasoningEffort: state.effort,
    setServiceTier: state.serviceTier,
  }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    loading: false,
    error: null,
    reload: vi.fn(),
    providerItems: () => [
      { id: "first-model", label: "首个模型" },
      { id: "selected-model", label: "当前模型" },
    ],
    openAiModels: ["first-model", "selected-model"].map((id) => ({
      id,
      model: id,
      displayName: id,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"].map(
        (reasoningEffort) => ({ reasoningEffort }),
      ),
      serviceTiers: [{ id: "fast", name: "Fast", description: "快速" }],
    })),
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.thread = "first";
  state.effortValue = "high";
  useLayoutStore.setState({ view: "agent" });
});
afterEach(() => vi.useRealTimers());

function composer(owner: string, threadId: string | null, expanded: boolean) {
  return (
    <div className="session-mode">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          state.submit();
        }}
        onKeyDown={state.bubble}
      >
        <section
          className={
            expanded
              ? "session-composer-sheet is-full"
              : "session-codex-composer"
          }
          data-draft-owner={expanded ? undefined : owner}
        >
          {expanded ? (
            <div className="session-rich-draft">
              <textarea aria-label="未发送草稿" defaultValue="保留原草稿" />
            </div>
          ) : (
            <div className="session-native-editor-slot">
              <div
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="未发送草稿"
                tabIndex={0}
              >
                保留原草稿
              </div>
            </div>
          )}
          <NativeModelSelector threadId={threadId} draftOwner={owner} />
        </section>
      </form>
    </div>
  );
}
function mount(
  expanded = false,
  threadId: string | null = "first",
  owner = "draft:first",
) {
  state.thread = threadId;
  const view = render(composer(owner, threadId, expanded));
  const editor = screen.getByRole("textbox", { name: "未发送草稿" });
  vi.spyOn(editor, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  return {
    ...view,
    editor,
    trigger: screen.getByRole("button", { name: /^模型：/ }),
  };
}
async function open(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("menu");
  const caption = screen.getByRole("menuitem", {
    name: "选择模型",
  });
  caption.focus();
  return caption;
}
async function advanced(trigger: HTMLElement, keyboard = false) {
  const caption = await open(trigger);
  if (keyboard) fireEvent.keyDown(caption, { key: "Enter" });
  else fireEvent.click(caption);
  return screen.findByRole("menuitemradio", { name: "当前模型" });
}

it.each([false, true])(
  "navigates the actual %s expanded power menu with arrows and Tab without changing effort",
  async (expanded) => {
    const { trigger } = mount(expanded);
    const caption = await open(trigger);
    const power = screen.getByRole("menuitem", { name: "强度" });
    fireEvent.keyDown(caption, { key: "ArrowDown" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox")),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(power));
    fireEvent.keyDown(power, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(caption);
    fireEvent.keyDown(caption, { key: "Tab" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(power);
    fireEvent.keyDown(power, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(power);
    expect(state.effort).not.toHaveBeenCalled();
    fireEvent.keyDown(power, { key: "ArrowLeft" });
    expect(state.effort).toHaveBeenCalledExactlyOnceWith("medium");
    expect(power.getAttribute("aria-keyshortcuts")).toBe(
      "ArrowLeft ArrowRight",
    );
  },
);

it.each([
  ["ArrowLeft", "low"],
  ["ArrowRight", "high"],
])(
  "adjusts power with %s while keeping its menu row focused",
  async (key, effort) => {
    state.effortValue = "medium";
    const { trigger } = mount();
    await open(trigger);
    const power = screen.getByRole("menuitem", { name: "强度" });
    power.focus();
    fireEvent.keyDown(power, { key });
    expect(state.effort).toHaveBeenCalledExactlyOnceWith(effort);
    expect(document.activeElement).toBe(power);
    expect(screen.getByRole("menu")).toBeDefined();
  },
);

it.each([false, true])(
  "confirms the %s expanded power row with Enter and returns to its unchanged draft",
  async (expanded) => {
    const { editor, trigger } = mount(expanded);
    await open(trigger);
    const power = screen.getByRole("menuitem", { name: "强度" });
    power.focus();
    state.bubble.mockClear();
    expect(fireEvent.keyDown(power, { key: "Enter" })).toBe(false);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect(state.bubble).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.effort).not.toHaveBeenCalled();
    expect(
      editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent,
    ).toBe("保留原草稿");
  },
);

it.each(["owner", "thread", "page", "mode", "inert", "detached"])(
  "rejects a stale %s destination when power Enter closes",
  async (changed) => {
    const { editor, trigger } = mount();
    await open(trigger);
    const power = screen.getByRole("menuitem", { name: "强度" });
    const scope = editor.closest<HTMLElement>(".session-codex-composer")!;
    if (changed === "owner") scope.dataset.draftOwner = "other";
    if (changed === "thread") state.thread = "other";
    if (changed === "page") useLayoutStore.setState({ view: "settings" });
    if (changed === "mode")
      scope.closest<HTMLElement>(".session-mode")!.hidden = true;
    if (changed === "inert") scope.setAttribute("inert", "");
    if (changed === "detached") editor.remove();
    const focus = vi.spyOn(editor, "focus"),
      triggerFocus = vi.spyOn(trigger, "focus");
    fireEvent.keyDown(power, { key: "Enter" });
    await waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    expect(focus).not.toHaveBeenCalled();
    expect(triggerFocus).not.toHaveBeenCalled();
  },
);

it.each(["Enter", " "])(
  "focuses the checked model after a keyboard %s view toggle without a later container RAF",
  async (key) => {
    const { trigger } = mount();
    const caption = await open(trigger);
    fireEvent.keyDown(caption, { key });
    const checked = await screen.findByRole("menuitemradio", {
      name: "当前模型",
    });
    await waitFor(() => expect(document.activeElement).toBe(checked));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(document.activeElement).toBe(checked);
  },
);

it("preserves pointer view-toggle focus on the menu container", async () => {
  const { trigger } = mount();
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  const caption = await screen.findByRole("menuitem", { name: "选择模型" });
  fireEvent.pointerDown(caption, { button: 0, pointerType: "mouse" });
  fireEvent.click(caption);
  await screen.findByRole("menuitemradio", { name: "当前模型" });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("menu")),
  );
});

it("does not select or close the power menu when its thumb is clicked", async () => {
  const { trigger } = mount();
  await open(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "强度" }));
  expect(screen.getByRole("menu")).toBeDefined();
  expect(state.effort).not.toHaveBeenCalled();
  expect(state.submit).not.toHaveBeenCalled();
});

it("retains the advanced view on rapid reopen, cancels the old reset, and resets after 350ms closed", async () => {
  const { trigger } = mount();
  await advanced(trigger);
  vi.useFakeTimers();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await act(async () => vi.advanceTimersByTime(200));
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("menuitemradio", { name: "当前模型" })).toBeDefined();
  await act(async () => vi.advanceTimersByTime(200));
  expect(screen.getByRole("menuitemradio", { name: "当前模型" })).toBeDefined();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await act(async () => vi.advanceTimersByTime(350));
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "强度" })).toBeDefined();
});

it.each(["thread", "null-owner", "null-owner-ABA"])(
  "releases the old reset across %s changes without resetting the new menu",
  async (changed) => {
    const isNew = changed !== "thread";
    const first = isNew ? null : "first";
    const { trigger, rerender } = mount(false, first);
    await advanced(trigger);
    vi.useFakeTimers();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await act(async () => vi.advanceTimersByTime(200));
    state.thread = isNew ? null : "second";
    rerender(composer("draft:second", state.thread, false));
    if (changed.endsWith("ABA")) rerender(composer("draft:first", null, false));
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("menuitem", { name: "选择模型" }));
    expect(
      screen.getByRole("menuitemradio", { name: "当前模型" }),
    ).toBeDefined();
    await act(async () => vi.advanceTimersByTime(200));
    expect(
      screen.getByRole("menuitemradio", { name: "当前模型" }),
    ).toBeDefined();
  },
);

it("removes the pending view reset when the menu owner unmounts", async () => {
  const { trigger, unmount } = mount();
  await advanced(trigger);
  vi.useFakeTimers();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await act(async () => vi.advanceTimersByTime(100));
  unmount();
  await act(async () => vi.advanceTimersByTime(1));
  expect(vi.getTimerCount()).toBe(0);
});
