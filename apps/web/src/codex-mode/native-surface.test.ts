import { afterEach, expect, it, vi } from "vitest";
import { mountNativeSurface, nativeIframeUrl } from "./native-surface";
import { observeNativeContent } from "./native-content";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
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
  surface.setLayout?.({ frames: [{ id: "new:native-default", x: 0, y: 0, width: 800, height: 600 }], interactiveId: "new:native-default" });
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
    Object.defineProperty(parent, "getBoundingClientRect", { value: () => ({
      left: index * 40, right: index * 40 + 40, top: 70, bottom: 470, width: 40, height: 400,
    }) });
    document.body.append(parent); return frame;
  });
  const ids = ["019aabcd-1234-7890-abcd-0123456789ab", "019aabcd-1234-7890-abcd-0123456789ac"];
  const surface = mountNativeSurface(document, () => {}, undefined, { windowIds: ids });
  dispose = () => surface.dispose(); surface.start();
  surface.setLayout?.({ frames: [
    { id: `new:${ids[0]}`, x: 0, y: 0, width: 640, height: 700 },
    { id: `new:${ids[1]}`, x: 652, y: 180, width: 320, height: 340 },
  ], interactiveId: `new:${ids[1]}` });
  expect(frames.map((frame) => frame.style.getPropertyValue("--kanban-native-left"))).toEqual(["0px", "652px"]);
  expect(frames.map((frame) => frame.style.getPropertyValue("--kanban-native-top"))).toEqual(["0px", "180px"]);
  expect(frames.map((frame) => frame.style.getPropertyValue("--kanban-native-width"))).toEqual(["640px", "320px"]);
  expect(frames.map((frame) => frame.style.getPropertyValue("--kanban-native-height"))).toEqual(["700px", "340px"]);
  expect(frames.map((frame) => getComputedStyle(frame).pointerEvents)).toEqual(["none", "auto"]);
});

it("blocks inactive native iframes even when they remain visible in split view", () => {
  const frames = Array.from({ length: 2 }, () => {
    const parent = document.createElement("div");
    const frame = document.createElement("iframe");
    frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    parent.append(frame); document.body.append(parent); return frame;
  });
  const ids = ["019aabcd-1234-7890-abcd-0123456789ab", "019aabcd-1234-7890-abcd-0123456789ac"];
  const surface = mountNativeSurface(document, () => {}, undefined, { windowIds: ids });
  dispose = () => surface.dispose(); surface.start();
  const boxes = ids.map((id, index) => ({ id: `new:${id}`, x: index * 400, y: 0, width: 390, height: 500 }));
  surface.setLayout?.({ frames: boxes, interactiveId: `new:${ids[0]}` });
  expect(frames.map(frame => getComputedStyle(frame).pointerEvents)).toEqual(["auto", "none"]);
  surface.setLayout?.({ frames: boxes, interactiveId: `new:${ids[1]}` });
  expect(frames.map(frame => getComputedStyle(frame).pointerEvents)).toEqual(["none", "auto"]);
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
  surface.setLayout?.({ frames: [{ id: "new:native-default", x: 0, y: 0, width: 640, height: 480 }], interactiveId: "new:native-default" });
  expect(getComputedStyle(frame).pointerEvents).toBe("auto");
  surface.dispose();
  expect(editorLayer.hasAttribute("data-kanban-native-ancestor")).toBe(false);
  expect(nativeContainer.hasAttribute("data-kanban-native-ancestor")).toBe(false);
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
    Object.defineProperty(parent, "getBoundingClientRect", { value: () => ({
      left: index * 50, right: index * 50 + 50, top: 70, bottom: 470, width: 50, height: 400,
    }) });
    document.body.append(parent);
    return frame;
  });
  const counts: number[] = [];
  const surface = mountNativeSurface(document, (count) => counts.push(count), undefined, { windowIds });
  dispose = () => surface.dispose();
  surface.start();
  expect(counts.at(-1)).toBe(12);
  const frameBox = (id: string, x: number) => ({ id, x, y: 40, width: 300, height: 420 });
  surface.setLayout?.({ frames: [frameBox(`new:${windowIds[0]}`, 0), frameBox(`new:${windowIds[1]}`, 312)] });
  expect(frames[0]!.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(frames[1]!.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(frames[2]!.getAttribute("data-kanban-native-hidden")).toBe("true");
  const thirdWindowId = "019aabcd-1234-7890-abcd-0123456789ad";
  surface.bindWindowAtColumn?.(`new:${thirdWindowId}`, 3);
  surface.setLayout?.({ frames: [frameBox(`new:${windowIds[0]}`, 0), frameBox(`new:${thirdWindowId}`, 312)] });
  expect(frames[1]!.getAttribute("data-kanban-native-hidden")).toBe("true");
  expect(frames[2]!.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(frames.every((frame) => frame.parentElement?.isConnected)).toBe(true);
});

it("binds a newly inserted editor group by its native column instead of iframe creation order", () => {
  const initialIds = ["019aabcd-1234-7890-abcd-0123456789ab", "019aabcd-1234-7890-abcd-0123456789ac"];
  const dynamicId = "new:019aabcd-1234-7890-abcd-0123456789ad";
  const frames = [0, 200, 100].map((left, index) => {
    const group = document.createElement("div"); group.className = "editor-group-container";
    Object.defineProperty(group, "getBoundingClientRect", { value: () => ({ left, right: left + 100, top: 0, bottom: 500, width: 100, height: 500 }) });
    const editor = document.createElement("div"); editor.className = "editor-instance";
    Object.defineProperty(editor, "getBoundingClientRect", { value: () => ({ left, right: left + 100, top: 0, bottom: 500, width: 100, height: 500 }) });
    const owner = document.createElement("div"); owner.id = `webview-editor-element-${index}`;
    editor.append(owner); group.append(editor); document.body.append(group);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-parent-flow-to-element-id", owner.id);
    Object.defineProperty(overlay, "getBoundingClientRect", { value: () => ({ left, right: left + 100, top: 0, bottom: 500, width: 100, height: 500 }) });
    const frame = document.createElement("iframe"); frame.className = "webview ready";
    frame.src = `${location.origin}/native-codex/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
    overlay.append(frame); document.body.append(overlay); return frame;
  });
  const surface = mountNativeSurface(document, () => {}, undefined, { windowIds: initialIds });
  dispose = () => surface.dispose(); surface.start();
  surface.bindWindowAtColumn?.(dynamicId, 2);
  surface.setLayout?.({ frames: [{ id: `new:${initialIds[0]}`, x: 0, y: 0, width: 400, height: 500 }, { id: dynamicId, x: 412, y: 0, width: 380, height: 500 }], interactiveId: dynamicId });
  expect(frames.map(frame => frame.getAttribute("data-kanban-native-hidden"))).toEqual(["false", "true", "false"]);
  expect(frames.map(frame => getComputedStyle(frame).pointerEvents)).toEqual(["none", "none", "auto"]);
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
  const seen: string[] = [];
  const surface = mountNativeSurface(document, () => {}, undefined, { onHostInstance: (id) => seen.push(id) });
  dispose = () => surface.dispose();
  surface.start();
  const item = document.createElement("div");
  item.className = "statusbar-item";
  item.textContent = "Kanban host 019aabcd-1234-7890-abcd-0123456789ab";
  document.body.append(item);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(seen).toEqual(["019aabcd-1234-7890-abcd-0123456789ab"]);
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

function nativeContentFixture() {
  const frame = document.createElement("iframe");
  frame.className = "webview ready";
  frame.src = `${location.origin}/native-codex/static/out/vs/workbench/contrib/webview/browser/pre/index.html?extensionId=openai.chatgpt`;
  document.body.append(frame);
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
  const surface = mountNativeSurface(document, () => {}, count => ready.push(count));
  dispose = () => surface.dispose();
  surface.start();
  expect(ready.at(-1)).toBe(0);
  app.querySelector("#root")!.innerHTML = '<button>Next</button>';
  await vi.advanceTimersByTimeAsync(20);
  expect(ready.at(-1)).toBe(1);
  app.querySelector("#root")!.innerHTML = '<div class="startup-loader"></div>';
  await vi.advanceTimersByTimeAsync(20);
  expect(ready.at(-1)).toBe(0);
  await vi.advanceTimersByTimeAsync(70_000);
  app.querySelector("#root")!.innerHTML = '<button>Next</button>';
  await vi.advanceTimersByTimeAsync(20);
  expect(ready.at(-1)).toBe(1);
});

it("binds a restored thread to its actual column even when it was captured as a startup frame", async () => {
  const { frame, app } = nativeContentFixture();
  nativeContentFixture();
  const first = "019aabcd-5678-7890-abcd-0123456789ab";
  const second = "019aabcd-5678-7890-abcd-0123456789ac";
  const thread = "019aabcd-1234-7890-abcd-0123456789ab";
  app.querySelector("#root")!.innerHTML = `<div data-above-composer-portal data-above-composer-conversation-id="${thread}"><div contenteditable="true"></div></div>`;
  const report = vi.fn();
  const surface = mountNativeSurface(document, () => {}, () => {}, { windowIds: [first, second], onWindowState: report });
  dispose = () => surface.dispose();
  surface.start();
  surface.setLayout!({ frames: [{ id: thread, x: 0, y: 0, width: 900, height: 600 }] });
  surface.bindWindowAtColumn!(thread, 1);
  expect(frame.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(report).toHaveBeenCalledWith(thread, expect.objectContaining({ conversationId: thread, hasComposer: true }));
});

it("exposes the first startup window without waiting for a second iframe", () => {
  const { frame, app } = nativeContentFixture();
  app.querySelector("#root")!.innerHTML = '<button>Next</button>';
  const first = "019aabcd-5678-7890-abcd-0123456789ab";
  const report = vi.fn();
  const surface = mountNativeSurface(document, () => {}, () => {}, { windowIds: [first, "019aabcd-5678-7890-abcd-0123456789ac"], onWindowState: report });
  dispose = () => surface.dispose();
  surface.start();
  surface.setLayout!({ frames: [{ id: `new:${first}`, x: 0, y: 0, width: 900, height: 600 }] });
  expect(frame.getAttribute("data-kanban-native-hidden")).toBe("false");
  expect(report).toHaveBeenCalledWith(`new:${first}`, expect.objectContaining({ ready: true }));
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
  root.innerHTML = '<button>Next</button><div data-above-composer-portal="true"></div>';
  const states: Array<{ hasComposer: boolean; composerEmpty: boolean }> = [];
  const tracker = observeNativeContent(frame, () => {}, (state) => states.push(state));
  tracker.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(states.at(-1)?.hasComposer).toBe(false);
  root.insertAdjacentHTML("beforeend", '<div contenteditable="true"></div>');
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(states.at(-1)).toMatchObject({ hasComposer: true, composerEmpty: true });
  tracker.dispose();
});

it("reads the current native composer on demand before opening another chat", () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML = '<button>Next</button><div data-above-composer-portal="true"></div>';
  const tracker = observeNativeContent(frame, () => {});
  tracker.start();
  root.insertAdjacentHTML("beforeend", '<div contenteditable="true">draft A</div>');
  expect(tracker.snapshot()).toMatchObject({ hasComposer: true, composerEmpty: false });
  tracker.dispose();
});

it("observes an official writer lock that appears after the composer and clears after native Retry", async () => {
  const { frame, app } = nativeContentFixture();
  const root = app.getElementById("root")!;
  root.innerHTML = '<button>Chat</button><div data-above-composer-portal="true" data-above-composer-conversation-id="019aabcd-1234-7890-abcd-0123456789ab"></div><div contenteditable="true"></div>';
  const states: Array<{ blockedByOtherApp?: boolean; hasComposer: boolean }> = [];
  const tracker = observeNativeContent(frame, () => {}, (state) => states.push(state));
  tracker.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(states.at(-1)).toMatchObject({ blockedByOtherApp: false, hasComposer: true });
  const notice = document.createElement("div");
  notice.innerHTML = '<strong>This is open in another app</strong><span>Close it there to continue here.</span><button>Retry</button>';
  root.append(notice);
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(states.at(-1)).toMatchObject({ blockedByOtherApp: true, hasComposer: false });
  notice.remove();
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(states.at(-1)).toMatchObject({ blockedByOtherApp: false, hasComposer: true });
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
