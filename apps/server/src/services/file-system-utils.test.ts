import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findMarkdownProjectRoot,
  resolveMarkdownImagePath,
  resolveMarkdownImageResourcePath,
  validateChmodMode,
  VALID_CHMOD_PATTERN,
} from "./file-system-utils.js";

test("Markdown project discovery supports nested SFTP projects and stops on denied metadata", async () => {
  const calls: string[] = [];
  const result = await findMarkdownProjectRoot(
    "/projects/topic/papers/v10/paper.md",
    async (marker) => {
      calls.push(marker);
      if (marker === "/projects/topic/.git") return true;
      throw Object.assign(new Error("no such file"), { code: 2 });
    },
  );
  assert.equal(result, "/projects/topic");
  assert.equal(calls.at(-1), "/projects/topic/.git");
  calls.length = 0;
  assert.equal(
    await findMarkdownProjectRoot(
      "/projects/topic/docs/paper.md",
      async (marker) => {
        calls.push(marker);
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    ),
    undefined,
  );
  assert.equal(calls.length, 1);
  calls.length = 0;
  for (const document of ["/projects/topic/file.txt", "relative/paper.md"]) {
    assert.equal(
      await findMarkdownProjectRoot(document, async (marker) => {
        calls.push(marker);
        return true;
      }),
      undefined,
    );
  }
  assert.equal(calls.length, 0);
});

test("export image lookup stops at the root and preserves missing ordinary paths", async () => {
  const calls: string[] = [];
  const canonicalize = async (candidate: string) => {
    calls.push(candidate);
    if (candidate === "/workspace/project") return candidate;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  const input = {
    documentPath: "/workspace/project/docs/guide.md",
    rootPath: "/workspace/project/",
    source: "@./missing.png",
  };
  await assert.rejects(
    resolveMarkdownImageResourcePath(input, canonicalize),
    /ENOENT/,
  );
  assert.deepEqual(calls, [
    "/workspace/project",
    "/workspace/project/docs/missing.png",
    "/workspace/project/missing.png",
  ]);
  calls.length = 0;
  await assert.rejects(
    resolveMarkdownImageResourcePath(
      { ...input, source: "./missing.png" },
      canonicalize,
    ),
    /ENOENT/,
  );
  assert.deepEqual(calls, [
    "/workspace/project",
    "/workspace/project/docs/missing.png",
  ]);
});

test("export image lookup refuses symlink escapes and permission failures without fallback", async () => {
  const input = {
    documentPath: "/workspace/project/docs/guide.md",
    rootPath: "/workspace/project",
    source: "@./figure.png",
  };
  for (const failure of ["escape", "denied"]) {
    const calls: string[] = [];
    await assert.rejects(
      resolveMarkdownImageResourcePath(input, async (candidate) => {
        calls.push(candidate);
        if (candidate === input.rootPath) return candidate;
        if (failure === "escape") return "/outside/figure.png";
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }),
      failure === "escape"
        ? /outside the file browser root/
        : /permission denied/,
    );
    assert.equal(calls.length, 2);
  }
});

test("export image lookup handles SFTP missing-file status and URL encoded filenames", async () => {
  const input = {
    documentPath: "/workspace/project/docs/guide.md",
    rootPath: "/workspace/project",
    source: "@./figure%201.png?raw=1#image",
  };
  const result = await resolveMarkdownImageResourcePath(
    input,
    async (candidate) => {
      if (
        candidate === input.rootPath ||
        candidate === "/workspace/project/figure 1.png"
      )
        return candidate;
      throw Object.assign(new Error("no such file"), { code: 2 });
    },
  );
  assert.equal(result, "/workspace/project/figure 1.png");
});

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
