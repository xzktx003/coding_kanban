import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  shouldPreserveSessionControlKey,
  isSidebarGroupCollapsed,
} from "./session-navigation.js";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};
test("native and ARIA controls keep Tab Enter Space while terminal text entry still forwards", () => {
  const doc = new JSDOM(
    '<button><span id="label">Open</span></button><a href="#" id="link">Link</a><div id="static">Static</div>',
  ).window.document;
  const target = doc.querySelector<HTMLElement>("#label")!;
  const mockTerminalKeys: string[] = [];
  for (const key of ["Tab", "Enter", " ", "a"])
    if (!shouldPreserveSessionControlKey(key, target))
      mockTerminalKeys.push(key);
  assert.deepEqual(mockTerminalKeys, ["a"]);
  assert.equal(
    shouldPreserveSessionControlKey(
      "Enter",
      doc.querySelector<HTMLElement>("#link"),
    ),
    true,
  );
  assert.equal(
    shouldPreserveSessionControlKey(
      "Enter",
      doc.querySelector<HTMLElement>("#static"),
    ),
    false,
  );
});
test("search temporarily reveals matches without persisting group collapse changes", () => {
  const groups = { groups: [], assignments: {}, collapsedGroupIds: ["review"] };
  assert.equal(isSidebarGroupCollapsed(true, "review", groups, ""), true);
  assert.equal(isSidebarGroupCollapsed(true, "review", groups, "匹配"), false);
  assert.deepEqual(groups.collapsedGroupIds, ["review"]);
  assert.equal(isSidebarGroupCollapsed(true, "review", groups, ""), true);
});
