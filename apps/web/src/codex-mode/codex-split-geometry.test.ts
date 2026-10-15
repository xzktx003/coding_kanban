import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { codexDropTarget, codexNativeFrames, codexPaneBoxes } from "./codex-split-geometry";
import { appendCodexNewWindow, initialCodexWindows, openCodexConversation, placeCodexWindow } from "./codex-multiwindow-state";

const first = "019aabcd-1234-7890-abcd-0123456789ab";
const second = "019aabcd-1234-7890-abcd-0123456789ac";

it("keeps the native stage inside the canvas instead of growing with conversation content", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "codex-mode.css"), "utf8");
  expect(css).toMatch(/\.codex-mode \.codex-mode-canvas\s*\{[^}]*overflow:\s*hidden/s);
  expect(css).toMatch(/\.codex-window-stage\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow:\s*hidden/s);
  expect(css).toMatch(/\.codex-window-stage > \[data-panel-group\][\s\S]*height:\s*100%/);
});

it("gives a nested split unequal rectangles instead of equal grid cells", () => {
  let state = appendCodexNewWindow(initialCodexWindows(first, "/tmp/project"), second, "/tmp/project");
  state = placeCodexWindow(state, `new:${second}`, state.activeGroupId, "right");
  state = openCodexConversation(state, { id: second, cwd: "/tmp/project", name: "第三", preview: "第三", updatedAt: 1 });
  state = placeCodexWindow(state, second, state.activeGroupId, "bottom");
  const boxes = codexPaneBoxes(state.tree, { width: 1012, height: 700 });
  expect(boxes.map((box) => [box.x, box.width, box.height])).toEqual([
    [0, 500, 700],
    [512, 500, 344],
    [512, 500, 344],
  ]);
  expect(codexNativeFrames(boxes).map((frame) => frame.y)).toEqual([44, 44, 400]);
  expect(codexNativeFrames(boxes)).toHaveLength(3);
});

it("shows only the active mobile group and hides its unselected tabs", () => {
  let state = appendCodexNewWindow(initialCodexWindows(first, "/tmp/project"), second, "/tmp/project");
  state = placeCodexWindow(state, `new:${second}`, state.activeGroupId, "right");
  const active = state.activeGroupId;
  const boxes = codexPaneBoxes(state.tree, { width: 390, height: 640 }, active);
  expect(boxes).toHaveLength(1);
  expect(boxes[0]).toMatchObject({ groupId: active, windowId: `new:${second}`, width: 390, height: 640 });
});

afterEach(() => Reflect.deleteProperty(document, "elementFromPoint"));

it("drops on a pane edge and inserts before the hovered tab", () => {
  const root = document.createElement("div");
  root.innerHTML = `
    <section data-codex-group="group-a">
      <div data-codex-tab-strip>
        <button data-codex-window="window-a"></button>
        <button data-codex-window="window-b"></button>
      </div>
      <div data-codex-group-body></div>
    </section>`;
  document.body.append(root);
  const strip = root.querySelector<HTMLElement>("[data-codex-tab-strip]")!;
  const tabs = Array.from(root.querySelectorAll<HTMLElement>("[data-codex-window]"));
  const body = root.querySelector<HTMLElement>("[data-codex-group-body]")!;
  vi.spyOn(strip, "getBoundingClientRect").mockReturnValue(rect(0, 0, 400, 32));
  tabs.forEach((tab, index) => vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(rect(index * 120, 0, 110, 32)));
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect(0, 40, 400, 500));
  let hit: Element = tabs[1]!;
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit });
  expect(codexDropTarget(root, 130, 10)).toEqual({ groupId: "group-a", edge: "center", beforeKey: "window-b" });
  hit = body;
  expect(codexDropTarget(root, 20, 80)?.edge).toBe("left");
  expect(codexDropTarget(root, 200, 500)?.edge).toBe("bottom");
  root.remove();
});

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect;
}
