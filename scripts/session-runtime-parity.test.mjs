import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const root = new URL("../", import.meta.url);
test("session runtime retains every HTTP and stream endpoint in the pinned upstream snapshot", () => {
  const upstream = JSON.parse(
    readFileSync(
      new URL("packages/session-runtime/UPSTREAM_ROUTES.json", root),
      "utf8",
    ),
  );
  const router = readFileSync(
    new URL("packages/session-runtime/web/src/router.rs", root),
    "utf8",
  );
  const implemented = new Set(
    [...router.matchAll(/\.route\(\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  assert.ok(upstream.length > 150);
  for (const path of upstream)
    assert.ok(implemented.has(path), `Missing upstream route ${path}`);
});
test("the migrated Rust package excludes desktop packaging and carries its upstream license", () => {
  const cargo = readFileSync(
    new URL("packages/session-runtime/Cargo.toml", root),
    "utf8",
  );
  assert.doesNotMatch(cargo, /"src-tauri"/);
  assert.match(
    readFileSync(new URL("packages/session-runtime/LICENSE", root), "utf8"),
    /MIT License/,
  );
});
