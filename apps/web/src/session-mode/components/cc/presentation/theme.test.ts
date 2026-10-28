import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// Ground truth: docs/designs/claude-render-alignment/theme-token-mapping-20261027.md
// The Claude tokens must follow a VS Code host variable when one exists and
// fall back to our own value in the browser, exactly as codex-presentation.css
// already does for the Codex renderer.

const css = readFileSync(
  resolve(__dirname, "../../../claude-presentation.css"),
  "utf8",
);

function blocks() {
  // Two token blocks: the base (light) one and the dark override.
  const dark = css.indexOf('.session-mode.dark');
  expect(dark).toBeGreaterThan(0);
  return { light: css.slice(0, dark), dark: css.slice(dark) };
}

test("tokens are scoped to Claude containers, never global", () => {
  // Leaking to :root would bleed into the Codex renderer and the rest of the app.
  expect(css).not.toMatch(/^\s*:root\s*\{/m);
  expect(css).toMatch(/\.session-mode\s+:is\(\s*\.claude-presentation/);
});

/**
 * Tokens that are legitimately ours rather than host-mapped: the timeline dot
 * colors are literals in the official index.css with no `--vscode-*`
 * equivalent, and `--claude-dot` is an internal alias the dot classes set.
 * Anything else must follow its VS Code host variable.
 */
const OWN_TOKENS = [
  "--claude-dot",
  "--claude-dot-success",
  "--claude-dot-failure",
  "--claude-dot-warning",
];

test("every host-mapped claude token reads through a vscode variable", () => {
  // Shape: --claude-x: var(--vscode-y, <fallback>)
  const decls = css.match(/--claude-[a-z-]+:\s*var\([^;]+;/g) ?? [];
  expect(decls.length).toBeGreaterThan(30);
  for (const decl of decls) {
    const name = decl.slice(0, decl.indexOf(":"));
    if (OWN_TOKENS.includes(name)) continue;
    expect(decl, decl).toMatch(/var\(\s*--vscode-[a-zA-Z-]+\s*,/);
  }
});

test("the own-token allowlist is exhaustive", () => {
  // Without this, a new token that skips its host variable could be waved
  // through just by appending to OWN_TOKENS.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set(
    (code.match(/--claude-[a-z-]+(?=\s*:)/g) ?? []).map((name) => name),
  );
  const nonHostMapped = [...names].filter((name) => {
    const decl = code.match(
      new RegExp(`${name}:\\s*[^;]+;`),
    )?.[0];
    return !!decl && !/var\(\s*--vscode-/.test(decl);
  });
  expect(nonHostMapped.sort()).toEqual([...OWN_TOKENS].sort());
});

test("chat typography fallbacks are pinned so spacing cannot drift", () => {
  // --vscode-chat-font-size is referenced 63 times by the official bundle, so
  // the whole transcript rhythm depends on this fallback being explicit.
  const { light } = blocks();
  expect(light).toMatch(/--claude-chat-size:\s*var\(\s*--vscode-chat-font-size,\s*13px\s*\)/);
  expect(light).toMatch(/--claude-chat-font:\s*var\(\s*--vscode-chat-font-family,/);
});

test("diff keeps line, text and gutter as three distinct semantics", () => {
  // Merging these loses character-level highlighting, which the official
  // renderer draws separately from whole-line and gutter backgrounds.
  for (const token of [
    "--claude-diff-inserted-line",
    "--claude-diff-removed-line",
    "--claude-diff-inserted-text",
    "--claude-diff-removed-text",
    "--claude-diff-inserted-gutter",
    "--claude-diff-removed-gutter",
  ])
    expect(css, token).toContain(token);

  expect(css).toMatch(
    /--claude-diff-inserted-line:\s*var\(\s*--vscode-diffEditor-insertedLineBackground/,
  );
  expect(css).toMatch(
    /--claude-diff-inserted-text:\s*var\(\s*--vscode-diffEditor-insertedTextBackground/,
  );
  expect(css).toMatch(
    /--claude-diff-inserted-gutter:\s*var\(\s*--vscode-diffEditorGutter-insertedLineBackground/,
  );
});

test("the ANSI palette is present for Bash output", () => {
  // Tool output renders as static HTML, not an xterm instance, so it needs
  // its own ANSI mapping.
  for (const color of [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "bright-black",
  ])
    expect(css, color).toContain(`--claude-ansi-${color}`);
});

test("dark mode redefines the surface and text tokens", () => {
  const { light, dark } = blocks();
  for (const token of [
    "--claude-surface",
    "--claude-text",
    "--claude-border",
    "--claude-link",
    "--claude-code-bg",
  ]) {
    expect(light, `light ${token}`).toContain(token);
    expect(dark, `dark ${token}`).toContain(token);
  }
});

test("claude tokens never reference or redefine codex tokens", () => {
  // Each agent aligns to its own plugin; cross-referencing would couple them.
  // Prose comments may mention the Codex namespace, so assert on real CSS.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(code).not.toMatch(/var\(\s*--codex-/);
  expect(code).not.toMatch(/--codex-[a-z-]+\s*:/);
});

test("timeline dot colors match the official literals", () => {
  expect(css).toContain("--claude-dot-success: #74c991");
  expect(css).toContain("--claude-dot-failure: #c74e39");
  expect(css).toContain("--claude-dot-warning: #e1c08d");
});
