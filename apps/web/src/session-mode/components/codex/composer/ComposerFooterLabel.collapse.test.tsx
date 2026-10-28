import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ComposerFooterLabel,
  ComposerToolbarProvider,
} from "./ComposerToolbarContext";

/**
 * Codex 26.51007.21434 collapses footer control labels on the **footer's own
 * inline size**, not the viewport. `vHi` in `app-initial-fee819fe4f22.js` renders
 * a `<span>` carrying `data-composer-footer-collapse={collapse}`, and
 * `app-initial-f5b2ced5ef25.css` hides it per tier:
 *
 *   ._ComposerLayoutFooter_boifs_2[data-composer-footer-responsive]
 *     {container: composer-footer/inline-size}
 *   @container composer-footer (width<=300px){
 *     ._ComposerFooterLabel_1cdoa_2[data-composer-footer-collapse=xs]{display:none}}
 *   @container composer-footer (width<=440px){
 *     ._ComposerFooterLabel_1cdoa_2[data-composer-footer-collapse=sm],
 *     ._ComposerFooterLabel_1cdoa_2[data-composer-footer-collapse=secondary]{display:none}}
 *
 * The 475/480/520px variants are `[data-codex-window-type=electron|browser]`
 * overrides; the extension webview sets `dataset.codexWindowType = "extension"`
 * (`app-initial-fee819fe4f22.js` @6047821), so the base tiers are the ones that
 * govern the surface we mirror.
 *
 * This has to be JS rather than a container query: jsdom does not evaluate
 * `@container` at all, so a CSS-only port is both untestable here and silently
 * dead if a rule is deleted. Measuring in JS also lets a side panel — a narrow
 * container at any viewport width — collapse the same way a phone does.
 */

type Entry = { contentRect: { width: number } };
let observers: { el: Element; fire: (width: number) => void }[] = [];
const realObserver = globalThis.ResizeObserver;

beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(private cb: (entries: Entry[]) => void) {}
    observe(el: Element) {
      observers.push({
        el,
        fire: (width) => this.cb([{ contentRect: { width } }]),
      });
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = realObserver;
});

// A real ResizeObserver callback runs outside React's batching, so the state
// update it triggers has to be flushed before the DOM can be read back.
const resize = (width: number) =>
  act(() => {
    for (const observer of observers) observer.fire(width);
  });

const mount = () =>
  render(
    <div className="session-mode">
      <ComposerToolbarProvider className="session-composer-toolbar">
        <ComposerFooterLabel collapse="xs">权限</ComposerFooterLabel>
        <ComposerFooterLabel collapse="sm">高</ComposerFooterLabel>
        <ComposerFooterLabel collapse="none">GPT-5</ComposerFooterLabel>
      </ComposerToolbarProvider>
    </div>,
  );

// The label text actually on screen. A collapsed label keeps its element (and
// its tier attribute, asserted separately below) but renders nothing, so an
// empty span is an absent label.
const labels = () =>
  [...document.querySelectorAll<HTMLElement>("[data-composer-footer-collapse]")]
    .map((span) => span.textContent)
    .filter((text) => text !== "");

it("marks the footer as its own responsive container", () => {
  // Official gates the container on `data-composer-footer-responsive`
  // (`rEn`/`i4i`), so the tiers measure the footer, not the page.
  mount();
  const toolbar = document.querySelector(".session-composer-toolbar")!;
  expect(toolbar.getAttribute("data-composer-footer-responsive")).toBe("");
  // The observer must be pointed at that same element, or the measured width
  // belongs to some ancestor and every tier fires at the wrong moment.
  expect(observers.map((o) => o.el)).toEqual([toolbar]);
});

it("keeps every label while the footer is wide", () => {
  mount();
  resize(900);
  expect(labels()).toEqual(["权限", "高", "GPT-5"]);
});

it("drops the sm tier first, at the 440px boundary", () => {
  mount();
  // 441px is still above the boundary: official's `width<=440px` is inclusive,
  // so the label survives one pixel wider.
  resize(441);
  expect(labels()).toEqual(["权限", "高", "GPT-5"]);
  resize(440);
  expect(labels()).toEqual(["权限", "GPT-5"]);
  // xs has not been reached, so the permissions label is still readable.
  resize(301);
  expect(labels()).toEqual(["权限", "GPT-5"]);
});

it("drops the xs tier at 300px and keeps an uncollapsible label", () => {
  mount();
  resize(300);
  // Only the model name survives: official gives it `collapse: "none"`, which
  // is what keeps the composer from becoming an unlabelled row of icons.
  expect(labels()).toEqual(["GPT-5"]);
  resize(120);
  expect(labels()).toEqual(["GPT-5"]);
});

it("restores labels when the footer grows back", () => {
  mount();
  resize(200);
  expect(labels()).toEqual(["GPT-5"]);
  resize(900);
  expect(labels()).toEqual(["权限", "高", "GPT-5"]);
});

it("publishes the tier as data even while the label is collapsed", () => {
  // The attribute is the contract the stylesheet reads, so it must survive the
  // collapse rather than the element being unmounted — otherwise a CSS-side
  // port of these same tiers would have nothing to match.
  mount();
  resize(200);
  const tiers = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-composer-footer-collapse]",
    ),
  ].map((span) => [
    span.dataset.composerFooterCollapse,
    span.dataset.composerFooterCollapsed,
  ]);
  expect(tiers).toEqual([
    ["xs", "true"],
    ["sm", "true"],
    ["none", undefined],
  ]);
});

it("treats an unmeasured footer as wide rather than hiding everything", () => {
  // A footer inside a hidden tab reports width 0 before it is ever laid out.
  // Collapsing on that would strip the labels off a composer the reader has
  // not even opened yet, and they would only reappear after a later resize.
  mount();
  expect(labels()).toEqual(["权限", "高", "GPT-5"]);
  resize(0);
  expect(labels()).toEqual(["权限", "高", "GPT-5"]);
});
