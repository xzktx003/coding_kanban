import { afterEach, expect, it, vi } from "vitest";
import { mountNativeSurface, nativeIframeUrl } from "./native-surface";
import { observeNativeContent } from "./native-content";

let dispose: (() => void) | undefined;
function sharedColumnFixture() {
  const group = document.createElement("div");
  group.className = "editor-group-container";
  const editor = document.createElement("div");
  editor.className = "editor-instance";
  for (const element of [group, editor])
    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 390,
        height: 700,
        right: 390,
        bottom: 700,
      }) as DOMRect;
  group.append(editor);
  document.body.append(group);
  return [0, 1].map((index) => {
    const owner = document.createElement("div");
    owner.id = `shared-editor-${index}`;
    editor.append(owner);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-parent-flow-to-element-id", owner.id);
    document.body.append(overlay);
    return nativeContentFixture(overlay);
  });
}

it("shows only the matching conversation when cached and current webviews share a column", () => {
  const [cached, current] = sharedColumnFixture();
  const thread = "019aabcd-1234-7890-abcd-000000000003";
  cached!.app.getElementById("root")!.innerHTML =
    "<textarea>cached draft</textarea>";
  current!.app.getElementById("root")!.innerHTML =
    `<div data-above-composer-portal data-above-composer-conversation-id="${thread}"></div><textarea>current draft</textarea>`;
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(thread, 1);
  surface.setLayout!({
    frames: [{ id: thread, x: 0, y: 44, width: 390, height: 650 }],
    interactiveId: thread,
  });
  expect(
    [cached!.frame, current!.frame].map((f) => f.dataset.kanbanNativeHidden),
  ).toEqual(["true", "false"]);
  expect(getComputedStyle(cached!.frame).visibility).toBe("hidden");
  expect(getComputedStyle(current!.frame).pointerEvents).toBe("auto");
  surface.pause();
  surface.start();
  expect(cached!.frame.dataset.kanbanNativeHidden).toBe("true");
  expect(cached!.app.querySelector("textarea")!.value).toBe("cached draft");
});

it("invalidates a failed native snapshot and publishes the same conversation again after its document recovers", () => {
  const { frame, app } = nativeContentFixture();
  const thread = "019aabcd-1234-7890-abcd-000000000083";
  app.getElementById("root")!.innerHTML =
    `<div data-above-composer-portal data-above-composer-conversation-id="${thread}"></div><textarea></textarea>`;
  const ready: boolean[] = [];
  const states: Array<{ ready: boolean; conversationId: string | null }> = [];
  const tracker = observeNativeContent(
    frame,
    (value) => ready.push(value),
    (value) => states.push(value),
  );
  dispose = () => tracker.dispose();
  tracker.start();
  expect(tracker.snapshot()?.conversationId).toBe(thread);
  vi.spyOn(app, "getElementById").mockImplementationOnce(() => {
    throw Error("document temporarily unavailable");
  });
  expect(tracker.snapshot()).toMatchObject({
    ready: false,
    conversationId: null,
    hasComposer: false,
  });
  expect(tracker.ready).toBe(false);
  expect(ready.at(-1)).toBe(false);
  expect(tracker.snapshot()).toMatchObject({
    ready: true,
    conversationId: thread,
    hasComposer: true,
  });
  expect(states.at(-1)).toMatchObject({ ready: true, conversationId: thread });
});

it("rechecks the current native frame document before returning a retained snapshot", () => {
  const { frame, app } = nativeContentFixture();
  const thread = "019aabcd-1234-7890-abcd-000000000084";
  app.getElementById("root")!.innerHTML =
    `<div data-above-composer-portal data-above-composer-conversation-id="${thread}"></div><textarea></textarea>`;
  const tracker = observeNativeContent(frame, () => {});
  dispose = () => tracker.dispose();
  tracker.start();
  expect(tracker.snapshot()?.conversationId).toBe(thread);
  vi.spyOn(frame, "contentDocument", "get").mockImplementationOnce(() => null);
  expect(tracker.snapshot()).toMatchObject({
    ready: false,
    conversationId: null,
    hasComposer: false,
  });
});

it("disconnects inaccessible frame documents so late mutations cannot revive stale readiness", async () => {
  const { frame, app } = nativeContentFixture();
  const thread = "019aabcd-1234-7890-abcd-000000000085";
  app.getElementById("root")!.innerHTML =
    `<div data-above-composer-portal data-above-composer-conversation-id="${thread}"><textarea></textarea></div>`;
  const tracker = observeNativeContent(frame, () => {});
  dispose = () => tracker.dispose();
  tracker.start();
  await Promise.resolve();
  const inaccessible = vi
    .spyOn(frame, "contentDocument", "get")
    .mockImplementation(() => {
      throw new Error("native document inaccessible");
    });
  try {
    expect(tracker.snapshot()?.ready).toBe(false);
    app
      .querySelector("[data-above-composer-portal]")!
      .setAttribute("class", "late-native-mutation");
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.ready).toBe(false);
  } finally {
    inaccessible.mockRestore();
  }
  expect(tracker.snapshot()).toMatchObject({
    ready: true,
    conversationId: thread,
  });
});

it("replaces an old column binding and selects only one original frame", () => {
  const fixtures = sharedColumnFixture();
  const first = "new:019aabcd-1234-7890-abcd-000000000003";
  const second = "new:019aabcd-1234-7890-abcd-000000000004";
  const surface = mountNativeSurface(document, () => {});
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(first, 1);
  surface.bindWindowAtColumn!(second, 1);
  surface.setLayout!({
    frames: [{ id: second, x: 0, y: 44, width: 390, height: 650 }],
    interactiveId: second,
  });
  expect(
    fixtures.filter(
      ({ frame }) => frame.dataset.kanbanNativeHidden === "false",
    ),
  ).toHaveLength(1);
  expect(
    fixtures.filter(
      ({ frame }) => frame.dataset.kanbanNativeInteractive === "true",
    ),
  ).toHaveLength(1);
});

it("keeps a collapsed native group in column numbering when restoring a blank new chat", () => {
  const [cached, current] = sharedColumnFixture();
  const collapsed = document.createElement("div");
  collapsed.className = "editor-group-container";
  document.body.prepend(collapsed);
  const id = "new:019aabcd-1234-7890-abcd-000000000005";
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(id, 2);
  surface.setLayout!({
    frames: [{ id, x: 0, y: 44, width: 390, height: 650 }],
    interactiveId: id,
  });
  expect(current!.frame.style.getPropertyValue("--kanban-native-column")).toBe(
    "1",
  );
  expect(current!.frame.dataset.kanbanNativeHidden).toBe("false");
  expect(current!.frame.dataset.kanbanNativeInteractive).toBe("true");
  expect(cached!.frame.dataset.kanbanNativeHidden).toBe("true");
});

it("does not expose an unrelated composer while the requested history is still loading", () => {
  const { frame, app } = nativeContentFixture();
  app.getElementById("root")!.innerHTML =
    "<textarea>unrelated new chat</textarea>";
  const thread = "019aabcd-1234-7890-abcd-000000000003";
  const report = vi.fn();
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
    { onWindowState: report },
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(thread, 1);
  surface.setLayout!({
    frames: [{ id: thread, x: 0, y: 44, width: 390, height: 650 }],
    interactiveId: thread,
  });
  expect(frame.dataset.kanbanNativeHidden).toBe("true");
  expect(report).not.toHaveBeenCalledWith(
    thread,
    expect.objectContaining({ ready: true }),
  );
});

it("recovers pending history from its exact portal event without waiting for another workbench mutation", async () => {
  const { frame, app } = nativeContentFixture();
  app.getElementById("root")!.innerHTML =
    "<textarea>unverified native editor</textarea>";
  const parent = frame.parentElement;
  const thread = "019aabcd-1234-7890-abcd-000000000008";
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(thread, 1);
  surface.setLayout!({
    frames: [{ id: thread, x: 6, y: 8, width: 1440, height: 800 }],
    interactiveId: thread,
  });
  expect(frame.dataset.kanbanNativeHidden).toBe("true");
  expect(frame.dataset.kanbanNativeInteractive).toBe("false");
  expect(frame.parentElement).toBe(parent);
  app.getElementById("root")!.innerHTML =
    `<div data-above-composer-portal data-above-composer-conversation-id="019aabcd-1234-7890-abcd-000000000009"></div><textarea>another thread</textarea>`;
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(frame.dataset.kanbanNativeHidden).toBe("true");
  expect(frame.dataset.kanbanNativeInteractive).toBe("false");
  app
    .querySelector("[data-above-composer-portal]")!
    .setAttribute("data-above-composer-conversation-id", thread);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(frame.style.getPropertyValue("--kanban-native-width")).toBe("1440px");
  expect(frame.dataset.kanbanNativeHidden).toBe("false");
  expect(frame.parentElement).toBe(parent);
});

it("withdraws readiness when the native conversation leaves the selected thread", async () => {
  const { frame, app } = nativeContentFixture();
  const thread = "019aabcd-1234-7890-abcd-000000000003";
  app.getElementById("root")!.innerHTML =
    `<div data-above-composer-portal data-above-composer-conversation-id="${thread}"></div><textarea>draft</textarea>`;
  const report = vi.fn();
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
    { onWindowState: report },
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(thread, 1);
  surface.setLayout!({
    frames: [{ id: thread, x: 0, y: 44, width: 390, height: 650 }],
    interactiveId: thread,
  });
  expect(frame.dataset.kanbanNativeHidden).toBe("false");
  app
    .querySelector("[data-above-composer-portal]")!
    .removeAttribute("data-above-composer-conversation-id");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(frame.dataset.kanbanNativeHidden).toBe("true");
  expect(report).toHaveBeenCalledWith(
    thread,
    expect.objectContaining({ ready: false, hasComposer: false }),
  );
});
it.each([1, 3])(
  "binds %i captured startup windows and keeps their original identity after pause",
  (count) => {
    const ids = Array.from(
      { length: count },
      (_, i) => `019aabcd-1234-7890-abcd-${String(i + 1).padStart(12, "0")}`,
    );
    const frames = ids.map(() => {
      const parent = document.createElement("div");
      const frame = document.createElement("iframe");
      frame.className = "webview ready";
      frame.src = `${location.origin}/native-codex/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
      parent.append(frame);
      document.body.append(parent);
      return frame;
    });
    const parents = frames.map((frame) => frame.parentElement);
    const surface = mountNativeSurface(document, () => {}, undefined, {
      windowIds: ids,
    });
    dispose = () => surface.dispose();
    surface.start();
    surface.setLayout?.({
      frames: ids.map((id, i) => ({
        id: `new:${id}`,
        x: i * 300,
        y: 44,
        width: 300,
        height: 500,
      })),
      interactiveId: `new:${ids[0]}`,
    });
    expect(
      frames.map((frame) => frame.getAttribute("data-kanban-native-hidden")),
    ).toEqual(ids.map(() => "false"));
    expect(getComputedStyle(frames[0]!).pointerEvents).toBe("auto");
    surface.pause();
    surface.start();
    expect(frames.map((frame) => frame.parentElement)).toEqual(parents);
    expect(
      frames.map((frame) => frame.getAttribute("data-kanban-native-hidden")),
    ).toEqual(ids.map(() => "false"));
  },
);
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("accepts only the captured same-origin native host path", () => {
  expect(
    nativeIframeUrl(
      "/native-codex/?folder=%2Ftmp%2Fprivate",
      "https://lan.example",
    ),
  ).toBe("/native-codex/?folder=%2Ftmp%2Fprivate");
  for (const value of [
    "https://evil.test/native-codex/",
    "//evil.test/native-codex/",
    "/native-codex/../api/",
    "/vscode/",
    "javascript:alert(1)",
    "/native-codex/#other",
    null,
  ]) {
    expect(nativeIframeUrl(value, "https://lan.example")).toBeNull();
  }
});

it("keeps each original iframe and parent intact and restores only owned surface attributes", () => {
  const parent = document.createElement("div");
  const frames = [0, 1].map(() => {
    const frame = document.createElement("iframe");
    frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    frame.style.top = "70px";
    parent.append(frame);
    return frame;
  });
  const worker = document.createElement("iframe");
  worker.className = "web-worker-ext-host-iframe";
  parent.append(worker);
  document.body.append(parent);
  const originalWindows = frames.map((f) => f.contentWindow);
  const counts: number[] = [];
  const surface = mountNativeSurface(document, (count) => counts.push(count));
  dispose = () => surface.dispose();
  surface.start();
  expect(counts).toEqual([2]);
  expect(frames.map((f) => f.contentWindow)).toEqual(originalWindows);
  expect(frames.every((f) => f.parentElement === parent)).toBe(true);
  expect(frames[0]!.style.top).toBe("70px");
  expect(frames[1]!.style.getPropertyValue("--kanban-native-column")).toBe("1");
  expect(worker.hasAttribute("data-kanban-native-surface")).toBe(false);
  surface.pause();
  surface.start();
  expect(counts).toEqual([2]);
  surface.dispose();
  expect(
    document.documentElement.classList.contains("kanban-native-surface"),
  ).toBe(false);
  expect(frames[1]!.style.getPropertyValue("--kanban-native-column")).toBe("");
  expect(frames[0]!.style.top).toBe("70px");
});

it("lets pointer input reach only the preserved native iframe through the workbench", () => {
  const workbench = document.createElement("div");
  workbench.className = "monaco-workbench";
  const container = document.createElement("div");
  const frame = document.createElement("iframe");
  frame.className = "webview ready";
  frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
  container.append(frame);
  workbench.append(container);
  document.body.append(workbench);
  const surface = mountNativeSurface(document, () => {});
  dispose = () => surface.dispose();
  surface.start();
  surface.setLayout?.({
    frames: [{ id: "new:native-default", x: 0, y: 0, width: 800, height: 600 }],
    interactiveId: "new:native-default",
  });
  expect(getComputedStyle(workbench).pointerEvents).toBe("none");
  expect(getComputedStyle(frame).pointerEvents).toBe("auto");
  expect(frame.parentElement).toBe(container);
});

it("places visible native iframes at arbitrary split rectangles", () => {
  const frames = Array.from({ length: 2 }, (_, index) => {
    const parent = document.createElement("div");
    const frame = document.createElement("iframe");
    frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    parent.append(frame);
    Object.defineProperty(parent, "getBoundingClientRect", {
      value: () => ({
        left: index * 40,
        right: index * 40 + 40,
        top: 70,
        bottom: 470,
        width: 40,
        height: 400,
      }),
    });
    document.body.append(parent);
    return frame;
  });
  const ids = [
    "019aabcd-1234-7890-abcd-0123456789ab",
    "019aabcd-1234-7890-abcd-0123456789ac",
  ];
  const surface = mountNativeSurface(document, () => {}, undefined, {
    windowIds: ids,
  });
  dispose = () => surface.dispose();
  surface.start();
  surface.setLayout?.({
    frames: [
      { id: `new:${ids[0]}`, x: 0, y: 0, width: 640, height: 700 },
      { id: `new:${ids[1]}`, x: 652, y: 180, width: 320, height: 340 },
    ],
    interactiveId: `new:${ids[1]}`,
  });
  expect(
    frames.map((frame) => frame.style.getPropertyValue("--kanban-native-left")),
  ).toEqual(["0px", "652px"]);
  expect(
    frames.map((frame) => frame.style.getPropertyValue("--kanban-native-top")),
  ).toEqual(["0px", "180px"]);
  expect(
    frames.map((frame) =>
      frame.style.getPropertyValue("--kanban-native-width"),
    ),
  ).toEqual(["640px", "320px"]);
  expect(
    frames.map((frame) =>
      frame.style.getPropertyValue("--kanban-native-height"),
    ),
  ).toEqual(["700px", "340px"]);
  expect(frames.map((frame) => getComputedStyle(frame).pointerEvents)).toEqual([
    "none",
    "auto",
  ]);
});

it("blocks inactive native iframes even when they remain visible in split view", () => {
  const frames = Array.from({ length: 2 }, () => {
    const parent = document.createElement("div");
    const frame = document.createElement("iframe");
    frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    parent.append(frame);
    document.body.append(parent);
    return frame;
  });
  const ids = [
    "019aabcd-1234-7890-abcd-0123456789ab",
    "019aabcd-1234-7890-abcd-0123456789ac",
  ];
  const surface = mountNativeSurface(document, () => {}, undefined, {
    windowIds: ids,
  });
  dispose = () => surface.dispose();
  surface.start();
  const boxes = ids.map((id, index) => ({
    id: `new:${id}`,
    x: index * 400,
    y: 0,
    width: 390,
    height: 500,
  }));
  surface.setLayout?.({ frames: boxes, interactiveId: `new:${ids[0]}` });
  expect(frames.map((frame) => getComputedStyle(frame).pointerEvents)).toEqual([
    "auto",
    "none",
  ]);
  surface.setLayout?.({ frames: boxes, interactiveId: `new:${ids[1]}` });
  expect(frames.map((frame) => getComputedStyle(frame).pointerEvents)).toEqual([
    "none",
    "auto",
  ]);
});

it("keeps every original webview ancestor visible for native pointer hit testing", () => {
  const workbench = document.createElement("div");
  workbench.className = "monaco-workbench";
  const editorLayer = document.createElement("div");
  const nativeContainer = document.createElement("div");
  const frame = document.createElement("iframe");
  frame.className = "webview ready";
  frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
  nativeContainer.append(frame);
  editorLayer.append(nativeContainer);
  workbench.append(editorLayer);
  document.body.append(workbench);
  const surface = mountNativeSurface(document, () => {});
  dispose = () => surface.dispose();
  surface.start();
  expect(editorLayer.hasAttribute("data-kanban-native-ancestor")).toBe(true);
  expect(getComputedStyle(editorLayer).visibility).toBe("visible");
  expect(getComputedStyle(editorLayer).position).toBe("fixed");
  expect(getComputedStyle(nativeContainer).visibility).toBe("visible");
  expect(getComputedStyle(nativeContainer).position).toBe("fixed");
  surface.setLayout?.({
    frames: [{ id: "new:native-default", x: 0, y: 0, width: 640, height: 480 }],
    interactiveId: "new:native-default",
  });
  expect(getComputedStyle(frame).pointerEvents).toBe("auto");
  surface.dispose();
  expect(editorLayer.hasAttribute("data-kanban-native-ancestor")).toBe(false);
  expect(nativeContainer.hasAttribute("data-kanban-native-ancestor")).toBe(
    false,
  );
});

it("surfaces only visible editor tabs and orders them by their original column", () => {
  const placements = [
    { left: 0, top: 800 },
    { left: 600, top: 70 },
    { left: 100, top: 70 },
  ];
  const frames = placements.map(({ left, top }) => {
    const container = document.createElement("div");
    const frame = document.createElement("iframe");
    frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    container.append(frame);
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          x: left,
          y: top,
          left,
          top,
          right: left + 224,
          bottom: top + 400,
          width: 224,
          height: 400,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    document.body.append(container);
    return frame;
  });
  const counts: number[] = [];
  const surface = mountNativeSurface(document, (count) => counts.push(count));
  dispose = () => surface.dispose();
  surface.start();
  expect(counts.at(-1)).toBe(2);
  expect(frames[0]!.hasAttribute("data-kanban-native-surface")).toBe(false);
  expect(frames[1]!.style.getPropertyValue("--kanban-native-column")).toBe("1");
  expect(frames[2]!.style.getPropertyValue("--kanban-native-column")).toBe("0");
  expect(
    document.documentElement.style.getPropertyValue("--kanban-native-columns"),
  ).toBe("2");
});

it("keeps more than eight original native frames and positions only selected windows", () => {
  const windowIds = [
    "019aabcd-1234-7890-abcd-0123456789ab",
    "019aabcd-1234-7890-abcd-0123456789ac",
  ];
  const frames = Array.from({ length: 12 }, (_, index) => {
    const parent = document.createElement("div");
    const frame = document.createElement("iframe");
    frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    parent.append(frame);
    Object.defineProperty(parent, "getBoundingClientRect", {
      value: () => ({
        left: index * 50,
        right: index * 50 + 50,
        top: 70,
        bottom: 470,
        width: 50,
        height: 400,
      }),
    });
    document.body.append(parent);
    return frame;
  });
  const counts: number[] = [];
  const surface = mountNativeSurface(
    document,
    (count) => counts.push(count),
    undefined,
    { windowIds },
  );
  dispose = () => surface.dispose();
  surface.start();
  expect(counts.at(-1)).toBe(12);
  const frameBox = (id: string, x: number) => ({
    id,
    x,
    y: 40,
    width: 300,
    height: 420,
  });
  surface.setLayout?.({
    frames: [
      frameBox(`new:${windowIds[0]}`, 0),
      frameBox(`new:${windowIds[1]}`, 312),
    ],
  });
  expect(frames[0]!.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(frames[1]!.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(frames[2]!.getAttribute("data-kanban-native-hidden")).toBe("true");
  const thirdWindowId = "019aabcd-1234-7890-abcd-0123456789ad";
  surface.bindWindowAtColumn?.(`new:${thirdWindowId}`, 3);
  surface.setLayout?.({
    frames: [
      frameBox(`new:${windowIds[0]}`, 0),
      frameBox(`new:${thirdWindowId}`, 312),
    ],
  });
  expect(frames[1]!.getAttribute("data-kanban-native-hidden")).toBe("true");
  expect(frames[2]!.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(frames.every((frame) => frame.parentElement?.isConnected)).toBe(true);
});

it("binds a newly inserted editor group by its native column instead of iframe creation order", () => {
  const initialIds = [
    "019aabcd-1234-7890-abcd-0123456789ab",
    "019aabcd-1234-7890-abcd-0123456789ac",
  ];
  const dynamicId = "new:019aabcd-1234-7890-abcd-0123456789ad";
  const frames = [0, 200, 100].map((left, index) => {
    const group = document.createElement("div");
    group.className = "editor-group-container";
    Object.defineProperty(group, "getBoundingClientRect", {
      value: () => ({
        left,
        right: left + 100,
        top: 0,
        bottom: 500,
        width: 100,
        height: 500,
      }),
    });
    const editor = document.createElement("div");
    editor.className = "editor-instance";
    Object.defineProperty(editor, "getBoundingClientRect", {
      value: () => ({
        left,
        right: left + 100,
        top: 0,
        bottom: 500,
        width: 100,
        height: 500,
      }),
    });
    const owner = document.createElement("div");
    owner.id = `webview-editor-element-${index}`;
    editor.append(owner);
    group.append(editor);
    document.body.append(group);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-parent-flow-to-element-id", owner.id);
    Object.defineProperty(overlay, "getBoundingClientRect", {
      value: () => ({
        left,
        right: left + 100,
        top: 0,
        bottom: 500,
        width: 100,
        height: 500,
      }),
    });
    const frame = document.createElement("iframe");
    frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    overlay.append(frame);
    document.body.append(overlay);
    return frame;
  });
  const surface = mountNativeSurface(document, () => {}, undefined, {
    windowIds: initialIds,
  });
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn?.(dynamicId, 2);
  surface.setLayout?.({
    frames: [
      { id: `new:${initialIds[0]}`, x: 0, y: 0, width: 400, height: 500 },
      { id: dynamicId, x: 412, y: 0, width: 380, height: 500 },
    ],
    interactiveId: dynamicId,
  });
  expect(
    frames.map((frame) => frame.getAttribute("data-kanban-native-hidden")),
  ).toEqual(["false", "true", "false"]);
  expect(frames.map((frame) => getComputedStyle(frame).pointerEvents)).toEqual([
    "none",
    "none",
    "auto",
  ]);
});

it("removed native frames are released and count changes once without polling", async () => {
  const frame = document.createElement("iframe");
  frame.className = "webview ready";
  frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
  document.body.append(frame);
  const counts: number[] = [];
  const surface = mountNativeSurface(document, (c) => counts.push(c));
  dispose = () => surface.dispose();
  surface.start();
  frame.remove();
  await new Promise((r) => setTimeout(r, 40));
  expect(counts).toEqual([1, 0]);
  expect(frame.hasAttribute("data-kanban-native-surface")).toBe(false);
});

it("does not expose another extension webview as a Codex window", () => {
  const frame = document.createElement("iframe");
  frame.className = "webview ready";
  frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=vscode.markdown-language-features`;
  document.body.append(frame);
  const counts: number[] = [];
  const surface = mountNativeSurface(document, (c) => counts.push(c));
  dispose = () => surface.dispose();
  surface.start();
  expect(counts).toEqual([0]);
  expect(frame.hasAttribute("data-kanban-native-surface")).toBe(false);
});

it("identifies only the current host instance from its own status bar marker", async () => {
  vi.stubGlobal("performance", {
    now: () => 0,
    getEntriesByName: () => [{ entryType: "mark" }],
  });
  const seen: string[] = [];
  const surface = mountNativeSurface(document, () => {}, undefined, {
    onHostInstance: (id) => seen.push(id),
  });
  dispose = () => surface.dispose();
  surface.start();
  const item = document.createElement("div");
  item.className = "statusbar-item";
  item.textContent = "Kanban host 019aabcd-1234-7890-abcd-0123456789ab";
  document.body.append(item);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(seen).toEqual(["019aabcd-1234-7890-abcd-0123456789ab"]);
});

it("waits for original workbench restoration before authorizing native host operations", () => {
  let restored = false;
  let emit = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("performance", {
    now: () => 0,
    getEntriesByName: (name: string) =>
      name === "code/didStartWorkbench" && restored
        ? [{ entryType: "mark" }]
        : [],
  });
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      constructor(
        callback: (entries: { getEntries: () => { name: string }[] }) => void,
      ) {
        emit = () =>
          callback({ getEntries: () => [{ name: "code/didStartWorkbench" }] });
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const item = document.createElement("div");
  item.className = "statusbar-item";
  item.textContent = "Kanban host 019aabcd-1234-7890-abcd-0123456789ab";
  document.body.append(item);
  const seen: string[] = [];
  const surface = mountNativeSurface(document, () => {}, undefined, {
    onHostInstance: (id) => seen.push(id),
  });
  dispose = () => surface.dispose();
  surface.start();
  expect(seen).toEqual([]);
  restored = true;
  emit();
  expect(seen).toEqual(["019aabcd-1234-7890-abcd-0123456789ab"]);
  surface.pause();
  expect(disconnect).toHaveBeenCalled();
  item.textContent = "Kanban host 019aabcd-1234-7890-abcd-0123456789ac";
  emit();
  expect(seen).toHaveLength(1);
  surface.start();
  expect(seen.at(-1)).toBe("019aabcd-1234-7890-abcd-0123456789ac");
});

it("does not infer workbench restoration when its original startup mark is unavailable", () => {
  vi.stubGlobal("performance", { now: () => 0 });
  const item = document.createElement("div");
  item.className = "statusbar-item";
  item.textContent = "Kanban host 019aabcd-1234-7890-abcd-0123456789ab";
  document.body.append(item);
  const seen = vi.fn();
  const surface = mountNativeSurface(document, () => {}, undefined, {
    onHostInstance: seen,
  });
  dispose = () => surface.dispose();
  surface.start();
  expect(seen).not.toHaveBeenCalled();
});

it("removes the original overlay container clip without changing its inline geometry", () => {
  const parent = document.createElement("div");
  parent.style.clipPath = "polygon(0px 0px, 30px 0px, 30px 30px, 0px 30px)";
  parent.style.overflow = "hidden";
  const frame = document.createElement("iframe");
  frame.className = "webview ready";
  frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
  parent.append(frame);
  document.body.append(parent);
  const original = parent.getAttribute("style");
  const surface = mountNativeSurface(document, () => {});
  dispose = () => surface.dispose();
  surface.start();
  expect(getComputedStyle(parent).clipPath).toBe("none");
  expect(getComputedStyle(parent).overflow).toBe("visible");
  expect(parent.getAttribute("style")).toBe(original);
  expect(frame.parentElement).toBe(parent);
  surface.dispose();
  expect(parent.getAttribute("data-kanban-native-container")).toBeNull();
  expect(parent.getAttribute("style")).toBe(original);
});

function nativeContentFixture(parent: HTMLElement = document.body) {
  const frame = document.createElement("iframe");
  frame.className = "webview ready";
  frame.src = `${location.origin}/native-codex/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
  parent.append(frame);
  const outer = frame.contentDocument!;
  outer.open();
  outer.write(
    '<!doctype html><html><body><iframe id="active-frame"></iframe></body></html>',
  );
  outer.close();
  const inner = outer.querySelector<HTMLIFrameElement>("#active-frame")!;
  const app = inner.contentDocument!;
  app.body.innerHTML =
    '<div id="root"><div class="startup-loader"></div></div>';
  return { frame, app };
}

it("keeps the startup cover until an official control appears and still notices a late guide", async () => {
  vi.useFakeTimers();
  const { app } = nativeContentFixture();
  const ready: number[] = [];
  const surface = mountNativeSurface(
    document,
    () => {},
    (count) => ready.push(count),
  );
  dispose = () => surface.dispose();
  surface.start();
  expect(ready.at(-1)).toBe(0);
  app.querySelector("#root")!.innerHTML = "<button>Next</button>";
  await vi.advanceTimersByTimeAsync(20);
  expect(ready.at(-1)).toBe(1);
  app.querySelector("#root")!.innerHTML = '<div class="startup-loader"></div>';
  await vi.advanceTimersByTimeAsync(20);
  expect(ready.at(-1)).toBe(0);
  await vi.advanceTimersByTimeAsync(70_000);
  app.querySelector("#root")!.innerHTML = "<button>Next</button>";
  await vi.advanceTimersByTimeAsync(20);
  expect(ready.at(-1)).toBe(1);
});

it("binds a restored thread to its actual column even when it was captured as a startup frame", async () => {
  const { frame, app } = nativeContentFixture();
  nativeContentFixture();
  const first = "019aabcd-5678-7890-abcd-0123456789ab";
  const second = "019aabcd-5678-7890-abcd-0123456789ac";
  const thread = "019aabcd-1234-7890-abcd-0123456789ab";
  app.querySelector("#root")!.innerHTML =
    `<div data-above-composer-portal data-above-composer-conversation-id="${thread}"><div contenteditable="true"></div></div>`;
  const report = vi.fn();
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
    { windowIds: [first, second], onWindowState: report },
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.setLayout!({
    frames: [{ id: thread, x: 0, y: 0, width: 900, height: 600 }],
  });
  surface.bindWindowAtColumn!(thread, 1);
  expect(frame.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(report).toHaveBeenCalledWith(
    thread,
    expect.objectContaining({ conversationId: thread, hasComposer: true }),
  );
});

it("exposes the first startup window without waiting for a second iframe", () => {
  const { frame, app } = nativeContentFixture();
  app.querySelector("#root")!.innerHTML = "<button>Next</button>";
  const first = "019aabcd-5678-7890-abcd-0123456789ab";
  const report = vi.fn();
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
    {
      windowIds: [first, "019aabcd-5678-7890-abcd-0123456789ac"],
      onWindowState: report,
    },
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.setLayout!({
    frames: [{ id: `new:${first}`, x: 0, y: 0, width: 900, height: 600 }],
  });
  expect(frame.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(report).toHaveBeenCalledWith(
    `new:${first}`,
    expect.objectContaining({ ready: true }),
  );
});

it("does not report transport-ready windows as usable until the original app has rendered", async () => {
  const { frame, app } = nativeContentFixture();
  const windows: number[] = [];
  const ready: number[] = [];
  const surface = mountNativeSurface(
    document,
    (c) => windows.push(c),
    (c) => ready.push(c),
  );
  dispose = () => surface.dispose();
  surface.start();
  expect(windows).toEqual([1]);
  expect(ready.at(-1)).toBe(0);
  app.querySelector("#root")!.innerHTML =
    "<button>Sign in with ChatGPT</button>";
  await new Promise((r) => setTimeout(r, 40));
  expect(ready.at(-1)).toBe(1);
  expect(frame.parentElement).toBe(document.body);
});

it("updates readiness when an existing startup loader changes class in place", async () => {
  const { app } = nativeContentFixture();
  app.getElementById("root")!.innerHTML =
    '<div class="startup-loader"><button>Loading</button></div>';
  const ready: number[] = [];
  const surface = mountNativeSurface(
    document,
    () => {},
    (count) => ready.push(count),
  );
  dispose = () => surface.dispose();
  surface.start();
  expect(ready.at(-1)).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const countBeforeLoaderRemoved = ready.length;
  app.querySelector(".startup-loader")!.classList.remove("startup-loader");
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(ready).toHaveLength(countBeforeLoaderRemoved + 1);
  expect(ready.at(-1)).toBe(1);
});

it("pauses content readiness observation when hidden and catches up without polling on return", async () => {
  const { app } = nativeContentFixture();
  app.querySelector("#root")!.innerHTML = "<button>Next</button>";
  const ready: number[] = [];
  const surface = mountNativeSurface(
    document,
    () => {},
    (c) => ready.push(c),
  );
  dispose = () => surface.dispose();
  surface.start();
  expect(ready.at(-1)).toBe(1);
  surface.pause();
  const previous = ready.length;
  app.querySelector("#root")!.replaceChildren();
  await new Promise((r) => setTimeout(r, 40));
  expect(ready).toHaveLength(previous);
  surface.start();
  expect(ready.at(-1)).toBe(0);
  app.querySelector("#root")!.innerHTML = "<button>Send</button>";
  await new Promise((r) => setTimeout(r, 40));
  expect(ready.at(-1)).toBe(1);
  surface.dispose();
  const final = ready.length;
  app.querySelector("#root")!.replaceChildren();
  await new Promise((r) => setTimeout(r, 40));
  expect(ready).toHaveLength(final);
});

it("reports the official renderer failure document for the bound target without claiming onboarding", () => {
  const { frame, app } = nativeContentFixture();
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  const report = vi.fn();
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
    { onWindowState: report },
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(threadId, 1);
  app.title = "Codex could not start";
  app.body.innerHTML =
    "<h1>Codex could not start</h1><p>The extension could not start its user interface.</p>";
  frame
    .contentDocument!.querySelector("iframe")!
    .dispatchEvent(new Event("load"));
  expect(report).toHaveBeenLastCalledWith(
    threadId,
    expect.objectContaining({
      ready: false,
      hasComposer: false,
      startupError: "renderer-timeout",
    }),
  );
  app.title = "ChatGPT";
  app.body.innerHTML = `<div id="root"><div data-above-composer-portal data-above-composer-conversation-id="${threadId}"></div><textarea></textarea></div>`;
  frame.contentDocument!
    .querySelector("iframe")!
    .dispatchEvent(new Event("load"));
  expect(report).toHaveBeenLastCalledWith(threadId, expect.objectContaining({ ready: true, hasComposer: true }));
  expect(report.mock.lastCall?.[1].startupError).toBeUndefined();
});

it("keeps official onboarding clickable in a requested history window without accepting a blank composer", () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    "<h1>Codex in your IDE</h1><button disabled>Back</button><button>Next</button>";
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  const report = vi.fn();
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
    { onWindowState: report },
  );
  dispose = () => surface.dispose();
  surface.start();
  surface.bindWindowAtColumn!(threadId, 1);
  surface.setLayout!({
    frames: [{ id: threadId, x: 0, y: 40, width: 400, height: 600 }],
    interactiveId: threadId,
  });
  expect(frame.dataset.kanbanNativeHidden).toBe("false");
  expect(frame.dataset.kanbanNativeInteractive).toBe("true");
  expect(report).toHaveBeenCalledWith(
    threadId,
    expect.objectContaining({
      onboarding: true,
      conversationId: null,
      hasComposer: false,
    }),
  );
});

it("observes the first conversation when native submission replaces the blank composer portal", async () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    "<div data-above-composer-portal><textarea></textarea></div>";
  const report = vi.fn();
  const tracker = observeNativeContent(frame, () => {}, report);
  dispose = () => tracker.dispose();
  tracker.start();
  expect(report.mock.lastCall?.[0].conversationId).toBeNull();
  const threadId = "019aabcd-1234-7890-abcd-0123456789ab";
  root.innerHTML = `<div data-above-composer-portal data-above-composer-conversation-id="${threadId}"><textarea></textarea></div>`;
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(report.mock.lastCall?.[0]).toMatchObject({
    ready: true,
    hasComposer: true,
    conversationId: threadId,
  });
});

it("observes a replacement composer after identity is known and releases structural observation while paused", async () => {
  vi.useFakeTimers();
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  const first = "019aabcd-1234-7890-abcd-0123456789ab";
  const second = "019aabcd-1234-7890-abcd-0123456789ac";
  root.innerHTML = `<section><div><div data-above-composer-portal data-above-composer-conversation-id="${first}"><textarea></textarea></div></div></section>`;
  const report = vi.fn();
  const tracker = observeNativeContent(frame, () => {}, report);
  dispose = () => tracker.dispose();
  tracker.start();
  expect(report.mock.lastCall?.[0].conversationId).toBe(first);
  await vi.advanceTimersByTimeAsync(30001);
  root.innerHTML = `<main><article><div data-above-composer-portal data-above-composer-conversation-id="${second}"><textarea>native draft</textarea></div></article></main>`;
  await vi.advanceTimersByTimeAsync(40);
  expect(report.mock.lastCall?.[0]).toMatchObject({
    conversationId: second,
    hasComposer: true,
    composerEmpty: false,
  });
  tracker.pause();
  report.mockClear();
  root.replaceChildren();
  await vi.advanceTimersByTimeAsync(40);
  expect(report).not.toHaveBeenCalled();
});

it("does not rescan a known composer for deep transcript mutations after the initial lock watch expires", async () => {
  vi.useFakeTimers();
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<section><div data-above-composer-portal data-above-composer-conversation-id="019aabcd-1234-7890-abcd-0123456789ab"><textarea></textarea></div></section><aside><div class="message"></div></aside>';
  const tracker = observeNativeContent(frame, () => {});
  dispose = () => tracker.dispose();
  tracker.start();
  await vi.advanceTimersByTimeAsync(30001);
  const query = vi.spyOn(root, "querySelector");
  try {
    root.querySelector(".message")!.append(app.createElement("span"));
    query.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    expect(query).not.toHaveBeenCalled();
  } finally {
    query.mockRestore();
  }
});

it("caps structural ancestor observation instead of retaining an arbitrary native DOM chain", () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    "<div>".repeat(100) +
    '<div data-above-composer-portal data-above-composer-conversation-id="019aabcd-1234-7890-abcd-0123456789ab"><textarea></textarea></div>' +
    "</div>".repeat(100);
  const observe = vi.spyOn(window.MutationObserver.prototype, "observe");
  const tracker = observeNativeContent(frame, () => {});
  dispose = () => tracker.dispose();
  try {
    tracker.start();
    const ancestors = observe.mock.calls.filter(
      ([, options]) => options?.childList && Object.keys(options).length === 1,
    );
    expect(ancestors.length).toBe(64);
  } finally {
    observe.mockRestore();
  }
});

it("observes only the original composer identity and refuses to replace a drafted new chat", async () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<button>Chat</button><div data-above-composer-portal="true" data-above-composer-conversation-id=""><div contenteditable="true"></div></div>';
  const states: Array<{
    ready: boolean;
    conversationId: string | null;
    hasComposer: boolean;
    composerEmpty: boolean;
  }> = [];
  const tracker = observeNativeContent(
    frame,
    () => {},
    (state) => states.push(state),
  );
  tracker.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(states.at(-1)).toMatchObject({
    ready: true,
    conversationId: null,
    hasComposer: true,
    composerEmpty: true,
  });

  const portal = root.querySelector<HTMLElement>(
    "[data-above-composer-portal]",
  )!;
  portal.setAttribute(
    "data-above-composer-conversation-id",
    "019aabcd-1234-7890-abcd-0123456789ab",
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(states.at(-1)?.conversationId).toBe(
    "019aabcd-1234-7890-abcd-0123456789ab",
  );

  const editor = root.querySelector<HTMLElement>("[contenteditable=true]")!;
  editor.textContent = "unsent draft";
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(states.at(-1)?.composerEmpty).toBe(false);
  tracker.dispose();
});

it("continues watching onboarding until the native composer appears outside an earlier portal", async () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<button>Next</button><div data-above-composer-portal="true"></div>';
  const states: Array<{ hasComposer: boolean; composerEmpty: boolean }> = [];
  const tracker = observeNativeContent(
    frame,
    () => {},
    (state) => states.push(state),
  );
  tracker.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(states.at(-1)?.hasComposer).toBe(false);
  root.insertAdjacentHTML("beforeend", '<div contenteditable="true"></div>');
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(states.at(-1)).toMatchObject({
    hasComposer: true,
    composerEmpty: true,
  });
  tracker.dispose();
});

it("reads the current native composer on demand before opening another chat", () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<button>Next</button><div data-above-composer-portal="true"></div>';
  const tracker = observeNativeContent(frame, () => {});
  tracker.start();
  root.insertAdjacentHTML(
    "beforeend",
    '<div contenteditable="true">draft A</div>',
  );
  expect(tracker.snapshot()).toMatchObject({
    hasComposer: true,
    composerEmpty: false,
  });
  tracker.dispose();
});

it("observes an official writer lock that appears after the composer and clears after native Retry", async () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<button>Chat</button><div data-above-composer-portal="true" data-above-composer-conversation-id="019aabcd-1234-7890-abcd-0123456789ab"></div><div contenteditable="true"></div>';
  const states: Array<{ blockedByOtherApp?: boolean; hasComposer: boolean }> =
    [];
  const tracker = observeNativeContent(
    frame,
    () => {},
    (state) => states.push(state),
  );
  tracker.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(states.at(-1)).toMatchObject({
    blockedByOtherApp: false,
    hasComposer: true,
  });
  const notice = document.createElement("div");
  notice.innerHTML =
    "<strong>This is open <em>in another app</em></strong><span>Close it there <em>to continue here.</em></span><button>Retry</button>";
  root.append(notice);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(states.at(-1)).toMatchObject({
    blockedByOtherApp: true,
    hasComposer: false,
  });
  notice.remove();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(states.at(-1)).toMatchObject({
    blockedByOtherApp: false,
    hasComposer: true,
  });
  tracker.dispose();
});

it("recognizes the official zh-CN writer lock and keeps watching while it stays up", async () => {
  vi.useFakeTimers();
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<button>Chat</button><div data-above-composer-portal="true" data-above-composer-conversation-id="019aabcd-1234-7890-abcd-0123456789ab"></div><div contenteditable="true"></div>';
  const tracker = observeNativeContent(frame, () => {});
  dispose = () => tracker.dispose();
  tracker.start();
  await vi.advanceTimersByTimeAsync(30_001);
  const notice = document.createElement("div");
  notice.setAttribute("role", "alert");
  notice.innerHTML =
    "<strong>已在另一个应用中打开</strong><span>请先在那边关闭会话，才能在这里继续。</span><button>重试</button>";
  root.append(notice);
  await vi.advanceTimersByTimeAsync(40);
  expect(tracker.snapshot()).toMatchObject({
    blockedByOtherApp: true,
    hasComposer: false,
  });
  notice.remove();
  await vi.advanceTimersByTimeAsync(40);
  expect(tracker.snapshot()).toMatchObject({
    blockedByOtherApp: false,
    hasComposer: true,
  });
});

it("does not treat an unrelated retry button as another app holding the thread", async () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<div data-above-composer-portal="true" data-above-composer-conversation-id="019aabcd-1234-7890-abcd-0123456789ab"></div><div contenteditable="true"></div><button>重试</button>';
  const tracker = observeNativeContent(frame, () => {});
  dispose = () => tracker.dispose();
  tracker.start();
  expect(tracker.snapshot()).toMatchObject({
    blockedByOtherApp: false,
    hasComposer: true,
  });
});

it("detects the writer lock without reading the entire conversation text on every check", async () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML =
    '<button>Chat</button><div data-above-composer-portal="true"></div><div contenteditable="true"></div>';
  Object.defineProperty(root, "textContent", {
    configurable: true,
    get() {
      throw new Error("unbounded conversation text read");
    },
  });
  const tracker = observeNativeContent(frame, () => {});
  tracker.start();
  expect(tracker.snapshot()?.hasComposer).toBe(true);
  const notice = document.createElement("div");
  notice.innerHTML =
    "<strong>This is open in another app</strong><span>Close it there to continue here.</span><button>Retry</button>";
  root.append(notice);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(tracker.snapshot()).toMatchObject({
    blockedByOtherApp: true,
    hasComposer: false,
  });
  tracker.dispose();
});

it("maps the two original webviews to their captured window identities by surface order", async () => {
  const windowIds = [
    "019aabcd-5678-7890-abcd-0123456789ab",
    "019aabcd-5678-7890-abcd-0123456789ac",
  ];
  const threadIds = [
    "019aabcd-1234-7890-abcd-0123456789ab",
    "019aabcd-1234-7890-abcd-0123456789ac",
  ];
  const apps = windowIds.map((_, index) => {
    const { app } = nativeContentFixture();
    app.getElementById("root")!.innerHTML =
      `<button>Chat</button><div data-above-composer-portal="true" data-above-composer-conversation-id="${threadIds[index]}"></div><div role="textbox"></div>`;
    return app;
  });
  const observed: Array<{ panelIndex: number; threadId: string | null }> = [];
  const surface = mountNativeSurface(
    document,
    () => {},
    () => {},
    {
      windowIds,
      onThreadState: (panelIndex, state) =>
        observed.push({ panelIndex, threadId: state.conversationId }),
    },
  );
  dispose = () => surface.dispose();
  surface.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(apps).toHaveLength(2);
  expect(observed).toContainEqual({ panelIndex: 0, threadId: threadIds[0]! });
  expect(observed).toContainEqual({ panelIndex: 1, threadId: threadIds[1]! });
});
