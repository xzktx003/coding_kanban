import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  resolveAppViewportHeight,
  resolveAppViewportOffsetTop,
} from "./viewport-height.js";

describe("resolveAppViewportHeight", () => {
  it("falls back to innerHeight when no narrower viewport height exists", () => {
    assert.equal(resolveAppViewportHeight({ innerHeight: 900 }), 900);
  });

  it("prefers the layout viewport when visual viewport values overreport the available height", () => {
    assert.equal(
      resolveAppViewportHeight({
        innerHeight: 932,
        visualViewportHeight: 928,
        documentElementClientHeight: 892,
      }),
      892,
    );
  });

  it("uses the fullscreen element height when it is the tightest visible bound", () => {
    assert.equal(
      resolveAppViewportHeight({
        innerHeight: 932,
        visualViewportHeight: 928,
        documentElementClientHeight: 904,
        fullscreenElementClientHeight: 884,
      }),
      884,
    );
  });

  it("clamps fullscreen height to the screen work area when the taskbar still consumes space", () => {
    assert.equal(
      resolveAppViewportHeight({
        innerHeight: 932,
        visualViewportHeight: 928,
        documentElementClientHeight: 904,
        screenAvailHeight: 892,
      }),
      892,
    );
  });

  it("rounds fractional viewport measurements before storing them", () => {
    assert.equal(
      resolveAppViewportHeight({
        visualViewportHeight: 801.6,
        documentElementClientHeight: 802,
      }),
      802,
    );
  });
});

describe("resolveAppViewportOffsetTop", () => {
  it("tracks the visual viewport when the software keyboard pans the page", () => {
    assert.equal(resolveAppViewportOffsetTop(184.6), 185);
  });

  it("never moves the app above the layout viewport", () => {
    assert.equal(resolveAppViewportOffsetTop(-12), 0);
    assert.equal(resolveAppViewportOffsetTop(Number.NaN), 0);
  });
});

describe("mobile viewport declaration", () => {
  it("lets the browser resize content around the software keyboard and safe areas", () => {
    const html = readFileSync(
      new URL("../../index.html", import.meta.url),
      "utf8",
    );

    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /interactive-widget=resizes-content/);
  });
});
