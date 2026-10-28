import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { NativeToolDisclosure } from "./NativeToolDisclosure";
import { RowStateContext } from "../thread/rowState";

/**
 * The expandable tool body is ours, not a port: Codex 26.51007.21434 ships no
 * show/hide-output affordance for a transcript tool row. Searching both locale
 * bundles for `localConversation.*` keys matching output/expand/collapse/details
 * returns `planSummary`, `reviewComments` and `summaryPanelExpandableList` only —
 * nothing under a tool or command namespace — and the one animated disclosure in
 * the webview (`_AnimatedDisclosure_16dt5_16`, native `<details>` +
 * `::details-content` + `interpolate-size`) belongs to the WebMCP tool catalog
 * page, where it wraps a tool's description and inputSchema panes.
 *
 * So there is no upstream behavior to match here, which is exactly why this
 * needs its own test: the contract is only what we decided it is.
 *
 * Two parts of that contract are easy to break silently. The body is kept out of
 * the accessibility tree AND out of the tab order while collapsed (`hidden` plus
 * `inert`) — `hidden` alone still leaves focusable descendants reachable. And
 * the expansion lives in the transcript-level map rather than component state,
 * because virtualized rows unmount when scrolled away; a row remounting
 * collapsed would silently discard what the reader had opened.
 */
const body = <button type="button">打开详情</button>;

it("keeps the collapsed body out of the tree and the tab order", () => {
  render(
    <NativeToolDisclosure summary="读取文件">{body}</NativeToolDisclosure>,
  );
  // The inner control is unreachable while collapsed, by role and by focus.
  expect(screen.queryByRole("button", { name: "打开详情" })).toBeNull();
  const toggle = screen.getByRole("button", { name: "读取文件" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  const region = document.querySelector(".codex-native-tool-body");
  expect(region?.hasAttribute("hidden")).toBe(true);
  // `hidden` hides it; only `inert` also takes its descendants out of tabbing.
  expect(region?.hasAttribute("inert")).toBe(true);
  // The toggle owns the region it controls, so the mark can be followed.
  expect(toggle.getAttribute("aria-controls")).toBe(region?.id);
});

it("reveals the body on toggle and restores it to the tree", () => {
  render(
    <NativeToolDisclosure summary="读取文件">{body}</NativeToolDisclosure>,
  );
  const toggle = screen.getByRole("button", { name: "读取文件" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "打开详情" })).toBeTruthy();
  const region = document.querySelector(".codex-native-tool-body");
  expect(region?.hasAttribute("hidden")).toBe(false);
  expect(region?.hasAttribute("inert")).toBe(false);
  fireEvent.click(toggle);
  expect(screen.queryByRole("button", { name: "打开详情" })).toBeNull();
});

it("survives the row unmounting and remounting while scrolled away", () => {
  // One map per row, the way the thread provides it around each virtual row.
  const cache = new Map<string, unknown>();
  const row = (
    <RowStateContext.Provider value={cache}>
      <NativeToolDisclosure summary="读取文件">{body}</NativeToolDisclosure>
    </RowStateContext.Provider>
  );
  const first = render(row);
  fireEvent.click(screen.getByRole("button", { name: "读取文件" }));
  expect(screen.getByRole("button", { name: "打开详情" })).toBeTruthy();
  // Scrolling the row off screen unmounts it; scrolling back must not collapse.
  first.unmount();
  render(row);
  expect(
    screen
      .getByRole("button", { name: "读取文件" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: "打开详情" })).toBeTruthy();
});

it("offers no toggle for a row that has no body to show", () => {
  render(<NativeToolDisclosure summary="读取文件" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(document.querySelector(".codex-native-tool-body")).toBeNull();
  // The summary still renders; only the affordance is withheld.
  expect(screen.getByText("读取文件")).toBeTruthy();
});
