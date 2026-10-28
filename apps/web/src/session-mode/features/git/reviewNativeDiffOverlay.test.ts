import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(directory, "review-native.css"), "utf8");

function rule(selector: string) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`missing rule: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/**
 * The hover overlay above a diff hunk is a direct port of the official
 * `code-diff-69d06ae95f1c.js` element:
 *
 *   pointer-events-none absolute -top-8.5 right-0.5 z-20 flex items-center
 *   gap-1 rounded-full bg-surface-secondary/90 px-0.5 py-0.5 opacity-0
 *   shadow-sm ring-1 ring-border/60 transition-opacity
 *   group-hover/file-diff:pointer-events-auto group-hover/file-diff:opacity-100
 *
 * Geometry came across exactly (`--spacing: .25rem`, so `-top-8.5` is -34px and
 * `right-0.5` is 2px), but the fade did not: Tailwind's bare `transition-opacity`
 * takes `--default-transition-duration` and `--default-transition-timing-function`,
 * which this build sets to `.15s` and `cubic-bezier(.4, 0, .2, 1)`. Ours faded in
 * 120ms on the browser default `ease`, so the control appeared slightly early and
 * on a different curve than every other official hover affordance.
 */
it("fades the diff hunk actions on the official duration and curve", () => {
  const actions = rule(".session-mode .codex-diff-hunk-annotation .codex-hunk-actions");
  expect(actions).toContain("150ms");
  expect(actions).toContain("cubic-bezier(0.4, 0, 0.2, 1)");
  // 120ms was ours, not the extension's; it must not survive the port.
  expect(actions).not.toContain("120ms");
});

/**
 * The same rule carries the geometry and surface the official element specifies.
 * Keeping these beside the duration stops a future "tidy up" from drifting the
 * overlay off the hunk while the timing assertion still passes.
 */
it("keeps the official geometry and surface for the hunk actions", () => {
  const actions = rule(".session-mode .codex-diff-hunk-annotation .codex-hunk-actions");
  expect(actions).toContain("top: -34px");
  expect(actions).toContain("right: 2px");
  expect(actions).toContain("z-index: 20");
  expect(actions).toContain("border-radius: 999px");
  expect(actions).toContain("opacity: 0");
  expect(actions).toContain("pointer-events: none");
  // bg-surface-secondary/90 and ring-border/60.
  expect(actions).toContain("var(--codex-secondary) 90%");
  expect(actions).toContain("var(--codex-border) 60%");
});
