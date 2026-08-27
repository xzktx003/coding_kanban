import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveMarkdownImagePath,
  validateChmodMode,
  VALID_CHMOD_PATTERN,
} from "./file-system-utils.js";

test("validateChmodMode accepts three- and four-digit octal modes", () => {
  assert.equal(VALID_CHMOD_PATTERN.test("600"), true);
  assert.equal(validateChmodMode("600"), 0o600);
  assert.equal(validateChmodMode("0600"), 0o600);
  assert.equal(validateChmodMode("1777"), 0o1777);
});

test("validateChmodMode rejects invalid or unsafe modes", () => {
  for (const mode of ["", "07555", "888", "12a4"]) {
    assert.throws(() => validateChmodMode(mode), /valid octal permission/);
  }

  assert.throws(
    () => validateChmodMode("4777"),
    /cannot combine world-writable with setuid\/setgid/,
  );
});

test("resolveMarkdownImagePath resolves document and project relative images", () => {
  assert.equal(
    resolveMarkdownImagePath({
      documentPath: "/workspace/project/docs/guide.md",
      rootPath: "/workspace/project",
      source: "./images/diagram%201.png?raw=1#preview",
    }),
    "/workspace/project/docs/images/diagram 1.png",
  );
  assert.equal(
    resolveMarkdownImagePath({
      documentPath: "/workspace/project/docs/guide.md",
      rootPath: "/workspace/project",
      source: "/assets/cover.webp",
    }),
    "/workspace/project/assets/cover.webp",
  );
  assert.equal(
    resolveMarkdownImagePath({
      documentPath: "/workspace/project/docs/guide.md",
      rootPath: "/workspace/project",
      source: "/workspace/project/assets/absolute.png",
    }),
    "/workspace/project/assets/absolute.png",
  );
});

test("resolveMarkdownImagePath permits contained parents and rejects escapes", () => {
  assert.equal(
    resolveMarkdownImagePath({
      documentPath: "/workspace/project/docs/guide.md",
      rootPath: "/workspace/project",
      source: "../assets/cover.png",
    }),
    "/workspace/project/assets/cover.png",
  );
  assert.throws(
    () =>
      resolveMarkdownImagePath({
        documentPath: "/workspace/project/docs/guide.md",
        rootPath: "/workspace/project",
        source: "../../secret.png",
      }),
    /outside the file browser root/,
  );
  assert.throws(
    () =>
      resolveMarkdownImagePath({
        documentPath: "/workspace/project/docs/guide.md",
        rootPath: "/workspace/project",
        source: "https://example.com/cover.png",
      }),
    /local Markdown image path/,
  );
});
