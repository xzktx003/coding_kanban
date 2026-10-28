import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));

function stylesheets(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/**
 * `@keyframes` names are document-global: unlike a selector, they cannot be
 * confined to `.session-mode`. Both modes' stylesheets load into the same
 * document, so a generic name here silently redefines, or is redefined by, a
 * same-named animation in terminal mode (`app.css` already owns `pulse`, `spin`
 * and `breathe-running`). Every session-mode animation is therefore prefixed
 * with the surface that owns it; this test keeps that true as files are added.
 */
const OWNER_PREFIXES = [
  "session-",
  "codex-",
  "claude-",
  "native-",
  "feedback-",
];

it("namespaces every session-mode keyframe to its owning surface", () => {
  const offenders: string[] = [];
  for (const path of stylesheets(root)) {
    const css = readFileSync(path, "utf8");
    for (const match of css.matchAll(/@keyframes\s+([A-Za-z_-][\w-]*)/g)) {
      const name = match[1];
      if (OWNER_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      offenders.push(`${relative(root, path)}: @keyframes ${name}`);
    }
  }
  expect(offenders).toEqual([]);
});

/**
 * A stylesheet whose classes nothing renders still ships its global keyframes.
 * Dead rules are how the unprefixed names above got in, so the import graph has
 * to justify every sheet `App.css` pulls in.
 */
it("renders at least one class from every imported stylesheet", () => {
  const appCss = readFileSync(join(root, "App.css"), "utf8");
  const imported = [...appCss.matchAll(/@import\s+"\.\/([^"]+\.css)"/g)].map(
    (match) => match[1],
  );
  expect(imported.length).toBeGreaterThan(0);

  const sources = (function walk(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  })(root).map((path) => readFileSync(path, "utf8"));

  const unused: string[] = [];
  for (const relativePath of imported) {
    const css = readFileSync(join(root, relativePath), "utf8");
    const classes = new Set(
      [...css.matchAll(/\.([a-z][\w-]*)/g)].map((match) => match[1]),
    );
    if (!classes.size) continue;
    const used = [...classes].some((name) =>
      sources.some((source) => source.includes(name)),
    );
    if (!used) unused.push(`${relativePath} (${classes.size} unused classes)`);
  }
  expect(unused).toEqual([]);
});
