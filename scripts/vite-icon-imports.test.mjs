import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createLucideImportOptimizer } from "./vite-icon-imports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("named aliases use exact installed icon modules while types, strings and namespace imports survive", () => {
  const optimizer = createLucideImportOptimizer({ projectRoot: root });
  const code = `import { Pin, Circle as Ring, type LucideIcon } from "lucide-react";\nconst sample = 'import { X } from "lucide-react"';\nimport * as All from "lucide-react";`;
  const result = optimizer.rewrite(code, "example.tsx");
  assert.match(result, /import Pin from "lucide-react\/dist\/esm\/icons\/pin\.mjs"/);
  assert.match(result, /import Ring from "lucide-react\/dist\/esm\/icons\/circle\.mjs"/);
  assert.match(result, /import type \{ LucideIcon \} from "lucide-react"/);
  assert.ok(result.includes(`const sample = 'import { X } from "lucide-react"'`));
  assert.ok(result.includes('import * as All from "lucide-react"'));
  assert.ok(optimizer.dependencies.includes("lucide-react/dist/esm/icons/pin.mjs"));
});
test("deprecated icon aliases retain exactly the original React component identity", async () => {
  const require = createRequire(resolve(root, "apps/web/package.json"));
  const packageRoot = dirname(require.resolve("lucide-react/package.json"));
  const metadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  const original = await import(pathToFileURL(resolve(packageRoot, metadata.module)).href);
  const optimizer = createLucideImportOptimizer({ projectRoot: root });
  const result = optimizer.rewrite('import { Fingerprint, FingerprintPattern } from "lucide-react";', "alias.tsx");
  const paths = [...result.matchAll(/from "lucide-react\/(.*?)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  const direct = await import(pathToFileURL(resolve(packageRoot, paths[0])).href);
  assert.equal(original.Fingerprint, direct.default);
  assert.equal(original.FingerprintPattern, direct.default);
});
test("ordinary source without icon imports and unknown exports are preserved", () => {
  const optimizer = createLucideImportOptimizer({ projectRoot: root });
  const code = 'const a = "lucide-react";';
  assert.equal(optimizer.rewrite(code, "plain.ts"), code);
  const unknown = 'import { icons, createLucideIcon } from "lucide-react";';
  assert.equal(optimizer.rewrite(unknown, "dynamic.ts"), unknown);
});
test("the development facade uses one dependency entry and preserves named aliases", () => {
  const optimizer = createLucideImportOptimizer({ projectRoot: root });
  assert.match(optimizer.rewriteFacade('import { Pin as MyPin, Circle } from "lucide-react";', "icons.tsx"),
    /import \{ Pin as MyPin, Circle \} from "@kanban\/lucide-icons"/);
  assert.match(optimizer.facadeSource(), /export \{ default as Pin \} from "\/.*\/lucide-react\/dist\/esm\/icons\/pin.mjs"/);
  assert.equal(optimizer.rewriteFacade('const example = \'import { Pin } from "lucide-react"\';', "sample.tsx"),
    'const example = \'import { Pin } from "lucide-react"\';');
});
test("the facade resolves outside apps/web without a second node_modules tree", async () => {
  const optimizer = createLucideImportOptimizer({ projectRoot: root });
  const temporary = mkdtempSync(resolve(tmpdir(), "kanban-icons-"));
  try {
    const path = resolve(temporary, "lucide-facade.mjs");
    writeFileSync(path, optimizer.facadeSource());
    const facade = await import(pathToFileURL(path).href);
    const require = createRequire(resolve(root, "apps/web/package.json"));
    const packageRoot = dirname(require.resolve("lucide-react/package.json"));
    const original = await import(pathToFileURL(resolve(packageRoot, "dist/esm/icons/pin.mjs")).href);
    assert.equal(facade.Pin, original.default);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
