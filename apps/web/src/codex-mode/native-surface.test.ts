import { afterEach, expect, it } from "vitest";
import { mountNativeSurface, nativeIframeUrl } from "./native-surface";

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
