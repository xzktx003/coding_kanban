import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import {
  splitGroups,
  useSessionSplitStore,
} from "@session/stores/useSessionSplitStore";
import {
  SESSION_TAB_MIME,
  sessionTabDrag,
  sessionDragKey,
  placeSessionDrag,
  sessionDropTarget,
} from "./sessionTabDrag";

const cards = [
  { kind: "codex" as const, id: "a", preview: "第一条" },
  { kind: "codex" as const, id: "b", preview: "第二条" },
];
const originalPoint = Object.getOwnPropertyDescriptor(
  document,
  "elementFromPoint",
);
beforeEach(() => {
  sessionTabDrag.key = null;
  useAgentCenterStore.setState({ cards, detachedCard: null });
  useSessionSplitStore.getState().reset();
  useSessionSplitStore.getState().reconcile(["codex:a", "codex:b"]);
});
afterEach(() => {
  if (originalPoint)
    Object.defineProperty(document, "elementFromPoint", originalPoint);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

it("native drop can recover its source from dataTransfer after a React refresh", () => {
  const getData = vi.fn((type) => (type === SESSION_TAB_MIME ? "codex:b" : ""));
  expect(sessionDragKey({ getData })).toBe("codex:b");
  const groupId = useSessionSplitStore.getState().tree.id;
  placeSessionDrag(sessionDragKey({ getData })!, { groupId, edge: "right" });
  expect(
    splitGroups(useSessionSplitStore.getState().tree).map(
      (group) => group.keys,
    ),
  ).toEqual([["codex:a"], ["codex:b"]]);
});

it("resolves the remotely unfollowed reading tab at release without adding it back", () => {
  useAgentCenterStore.setState({ cards: [cards[0]], detachedCard: cards[1] });
  const groupId = useSessionSplitStore.getState().tree.id;
  expect(placeSessionDrag("codex:b", { groupId, edge: "bottom" })).toEqual(
    cards[1],
  );
  expect(
    splitGroups(useSessionSplitStore.getState().tree).map(
      (group) => group.keys,
    ),
  ).toEqual([["codex:a"], ["codex:b"]]);
  expect(useAgentCenterStore.getState().cards).toEqual([cards[0]]);
});

it("does not recreate a tab that was closed while dragging", () => {
  useAgentCenterStore.setState({ cards: [cards[0]] });
  const before = useSessionSplitStore.getState().tree;
  expect(
    placeSessionDrag("codex:b", { groupId: before.id, edge: "right" }),
  ).toBeUndefined();
  expect(useSessionSplitStore.getState().tree).toBe(before);
});

function dropFixture() {
  const root = document.createElement("div");
  root.innerHTML =
    '<section data-session-group="target"><div data-session-group-body></div></section>';
  const body = root.querySelector<HTMLElement>("[data-session-group-body]")!;
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    left: 100,
    top: 100,
    right: 500,
    bottom: 400,
    width: 400,
    height: 300,
  } as DOMRect);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => body,
  });
  return root;
}

it.each([
  [105, 250, "left"],
  [495, 250, "right"],
  [300, 105, "top"],
  [300, 395, "bottom"],
  [505, 250, "right"],
  [300, 250, "center"],
] as const)(
  "uses final pointer coordinates (%s, %s) for the %s drop zone",
  (x, y, edge) => {
    expect(sessionDropTarget(dropFixture(), x, y)).toMatchObject({
      groupId: "target",
      edge,
    });
  },
);

it("does not extend the split target into distant tools or empty space", () => {
  const root = dropFixture();
  expect(sessionDropTarget(root, 520, 250)).toBeNull();
  const tool = document.createElement("div");
  tool.className = "session-desktop-tool-dock";
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => tool,
  });
  expect(sessionDropTarget(root, 495, 250)).toBeNull();
});
