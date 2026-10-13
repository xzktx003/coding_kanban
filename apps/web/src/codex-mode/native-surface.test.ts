import { afterEach, expect, it } from "vitest";
import { mountNativeSurface, nativeIframeUrl } from "./native-surface";
import { observeNativeContent } from "./native-content";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
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
  expect(getComputedStyle(workbench).pointerEvents).toBe("none");
  expect(getComputedStyle(frame).pointerEvents).toBe("auto");
  expect(frame.parentElement).toBe(container);
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
