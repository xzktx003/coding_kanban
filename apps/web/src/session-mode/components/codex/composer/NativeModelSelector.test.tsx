import { useConfigStore } from "../stores/useConfigStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import { NativeModelSelector } from "./NativeModelSelector";
import { useLayoutStore } from "@session/stores/useLayoutStore";
const calls = vi.hoisted(() => ({
  provider: "openai",
  magpieRefresh: vi.fn(),
  model: vi.fn(),
  effort: vi.fn(),
  effortValue: "high",
  options: ["low", "medium", "high"],
  currentThreadId: "original" as string | null,
  modelStatus: "success" as "success" | "error",
  modelError: null as string | null,
  hasModelSnapshot: true,
  reload: vi.fn(),
}));
const newChatCatalog = vi.hoisted(() => ({
  magpieModels: [{ id: "kimi/k3" }] as {id:string;reasoningEfforts?:("low"|"medium"|"high"|"max"|"ultra")[]}[],
}));
beforeEach(() => {
  newChatCatalog.magpieModels = [{id: "kimi/k3"}];
  calls.effort.mockClear();
  calls.provider = "openai";
  calls.effort.mockClear();
  calls.magpieRefresh.mockReset();
  useConfigStore.setState({modelSelectionMode:"manual"});
  calls.effortValue = "high";
  calls.options = ["low", "medium", "high"];
  calls.currentThreadId = "original";
  calls.modelStatus = "success";
  calls.modelError = null;
  calls.hasModelSnapshot = true;
  calls.reload.mockReset();
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
    modelProvider: calls.provider,
    reasoningEffort: calls.effortValue,
    setModel: calls.model,
    setReasoningEffort: calls.effort,
    setModelSelection: ({ model, reasoningEffort }: { model: string; reasoningEffort: string; serviceTier?: string | null }) => {
      if (model !== "model-one") calls.model(model);
      if (reasoningEffort !== calls.effortValue) calls.effort(reasoningEffort);
    },
  }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    loading: false,
    error: calls.modelError,
    reload: calls.reload,
    modelStatus: calls.modelStatus,
    hasModelSnapshot: calls.hasModelSnapshot,
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
vi.mock("../hooks/useMagpieCatalog", () => ({
  useMagpieCatalog: () => ({
    models: newChatCatalog.magpieModels,
    loading: false,
    refresh: calls.magpieRefresh,
  }),
}));
vi.mock("../hooks/useNewChatModelConfig", () => ({
  useNewChatModelConfig: () => ({
    cwd: "/project",
    value: {
      status: "ready",
      model: "configured-model",
      modelProvider: "magpie",
      reasoningEffort: "high",
    },
    loading: false,
    refresh: vi.fn(),
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

it("retains the known model and offers retry when a refresh fails", async () => {
  calls.modelStatus = "error";
  calls.modelError = "读取模型目录超时，请重试";
  render(<NativeModelSelector threadId="original" />);
  const trigger = screen.getByRole("button", { name: /^模型：model-one/ });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect((await screen.findByRole("alert")).textContent).toContain("读取模型目录超时，请重试");
  expect(trigger.getAttribute("aria-label")).toContain("model-one");
  fireEvent.click(screen.getByRole("menuitem", { name: "重试" }));
  expect(calls.reload).toHaveBeenCalledTimes(1);
});

it("uses the live Magpie catalog in the model list instead of saved provider presets", async () => {
  calls.provider = "magpie";
  render(<NativeModelSelector threadId="original" />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "选择模型" }));
  expect(await screen.findByRole("menuitemradio", { name: "kimi/k3" })).toBeDefined();
  expect(screen.queryByRole("menuitemradio", { name: "原生模型二" })).toBeNull();
});

it("refreshes the live Magpie catalog together with new-chat configuration", async () => {
  calls.currentThreadId = null;
  render(<NativeModelSelector threadId={null} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "刷新配置与模型" }));
  expect(calls.magpieRefresh).toHaveBeenCalledTimes(1);
});

it.each(["Magpie catalog selection", "pinning the configured model"])(
  "%s switches a following new chat to manual model selection",
  async (selection) => {
    calls.currentThreadId = null;
    useConfigStore.setState({
      modelSelectionMode: "follow-config",
      model: "new-chat-default",
      modelProvider: "openai",
    });
    render(<NativeModelSelector threadId={null} />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: /^跟随配置/ }),
      { key: "ArrowDown" },
    );
    const choice = await screen.findByRole("menuitem", {
      name: selection === "Magpie catalog selection"
        ? "kimi/k3"
        : "固定使用 configured-model",
    });
    fireEvent.click(choice);

    expect(useConfigStore.getState()).toMatchObject({
      modelSelectionMode: "manual",
      model: selection === "Magpie catalog selection"
        ? "kimi/k3"
        : "configured-model",
      modelProvider: "magpie",
    });
  },
);

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

it.each([
  { raw: "high", display: "高", maximum: "false" },
  { raw: "xhigh", display: "极高", maximum: "false" },
  { raw: "ultra", display: "Ultra", maximum: "true" },
])(
  "shows advertised ultra without rewriting raw $raw",
  async ({ raw, display, maximum }) => {
    calls.options = ["low", "medium", "high", "xhigh", "ultra"];
    calls.effortValue = raw;
    render(<NativeModelSelector threadId="original" />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), {
      key: "ArrowDown",
    });
    await screen.findByRole("menuitem", { name: "强度" });
    const label = document.querySelector(".session-native-power-effort")!;
    expect(label.textContent).toBe(display);
    expect(label.getAttribute("data-accent")).toBe("true");
    expect(label.getAttribute("data-maximum")).toBe(maximum);
    expect(document.querySelectorAll(".session-native-power-dot")).toHaveLength(5);
    expect(calls.effortValue).toBe(raw);
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

for (const threadId of [null, "original"]) {
  it(`exposes explicit Magpie effort choices beside the model list (${threadId ?? "new chat"})`, async () => {
    calls.provider = "magpie";
    calls.currentThreadId = threadId;
    calls.effort.mockClear();
    render(<NativeModelSelector threadId={threadId} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^模型：/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "选择模型" }));
    const high = await screen.findByRole("menuitemradio", { name: "推理强度：高" });
    expect(high.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "推理强度：轻度" }));
    expect(calls.effort).toHaveBeenCalledWith("low");
    expect(screen.getByRole("menuitemradio", { name: "kimi/k3" })).toBeDefined();
  });
}

it('uses advertised Magpie efforts including Max and Ultra without generic extras', async () => {
  calls.provider = 'magpie';
  newChatCatalog.magpieModels = [{id:'model-one',reasoningEfforts:['low','medium','high','max','ultra']}];
  render(<NativeModelSelector threadId='original' />);
  fireEvent.keyDown(screen.getByRole('button', {name:/^模型：/}),{key:'ArrowDown'});
  fireEvent.click(await screen.findByRole('menuitem',{name:'选择模型'}));
  expect(screen.getByRole('menuitemradio',{name:'推理强度：Max'})).toBeDefined();
  expect(screen.getByRole('menuitemradio',{name:'推理强度：Ultra'})).toBeDefined();
  expect(screen.queryByRole('menuitemradio',{name:'推理强度：无'})).toBeNull();
});
it('does not invent effort levels for an empty Magpie capability list', async () => {
  calls.provider = 'magpie';
  newChatCatalog.magpieModels = [{id:'model-one',reasoningEfforts:[]}];
  render(<NativeModelSelector threadId='original' />);
  fireEvent.keyDown(screen.getByRole('button', {name:/^模型：/}),{key:'ArrowDown'});
  expect(await screen.findByText('此模型不支持调整推理强度')).toBeDefined();
  expect(screen.queryByRole('menuitemradio',{name:/推理强度：/})).toBeNull();
  expect(calls.effort).not.toHaveBeenCalled();
});
