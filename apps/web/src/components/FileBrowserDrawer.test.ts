import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createMarkdownEditorState,
  FileBrowserDrawer,
  getFileBrowserPreviewGridRows,
  isMarkdownFileName,
} from "./FileBrowserDrawer.js";

describe("Markdown file detection", () => {
  it("recognizes md and markdown extensions case-insensitively", () => {
    assert.equal(isMarkdownFileName("README.md"), true);
    assert.equal(isMarkdownFileName("notes.MARKDOWN"), true);
    assert.equal(isMarkdownFileName("archive.md.txt"), false);
    assert.equal(isMarkdownFileName("markdown"), false);
  });

  it("opens Markdown files as an inline rendered preview", () => {
    assert.deepEqual(createMarkdownEditorState("/workspace/README.md", "# A"), {
      path: "/workspace/README.md",
      content: "# A",
      savedContent: "# A",
      mode: "preview",
    });
  });

  it("expands the preview inside the file browser instead of opening a dialog", () => {
    assert.equal(
      getFileBrowserPreviewGridRows(false, 240),
      "minmax(80px, 1fr) 8px 240px",
    );
    assert.equal(getFileBrowserPreviewGridRows(true, 240), "minmax(0, 1fr)");

    const source = readFileSync(
      new URL("./FileBrowserDrawer.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /MarkdownFileDialog|markdownDialogOpen/);
  });
});

describe("FileBrowserDrawer", () => {
  it("renders the file list without the legacy side directory tree", () => {
    const markup = renderToStaticMarkup(
      createElement(FileBrowserDrawer, {
        open: true,
        scopeKey: "test-scope",
        defaultPath: "/workspace",
        sshHosts: [],
        selectedHost: { type: "local" },
        onSelectHost: () => {},
      }),
    );

    assert.doesNotMatch(markup, /file-browser-tree/);
    assert.doesNotMatch(markup, /目录树/);
    assert.match(markup, /class="file-browser-content"/);
  });

  it("shows an up-level arrow next to the name header", () => {
    const markup = renderToStaticMarkup(
      createElement(FileBrowserDrawer, {
        open: true,
        scopeKey: "test-scope",
        defaultPath: "/workspace",
        sshHosts: [],
        selectedHost: { type: "local" },
        onSelectHost: () => {},
      }),
    );

    assert.match(markup, /class="file-browser-name-header"/);
    assert.match(
      markup,
      /class="file-browser-name-sort-button"[^>]*>名称 ↑<\/button>/,
    );
    assert.doesNotMatch(markup, /file-browser-sort-indicator/);
    assert.doesNotMatch(markup, /升序|降序/);
    assert.match(markup, /aria-label="返回上一级目录"/);
    assert.match(markup, /class="file-browser-up-one-level"[^>]*>↑<\/button>/);
  });

  it("renders owner metadata and draggable column separators", () => {
    const markup = renderToStaticMarkup(
      createElement(FileBrowserDrawer, {
        open: true,
        scopeKey: "test-scope",
        defaultPath: "/workspace",
        sshHosts: [],
        selectedHost: { type: "local" },
        onSelectHost: () => {},
      }),
    );

    assert.match(markup, />Owner<\/button>/);
    assert.match(markup, /class="file-browser-table-scroll"/);
    assert.match(markup, /role="separator"/);
    assert.match(markup, /data-testid="file-browser-column-resizer-name"/);
    assert.match(markup, /data-testid="file-browser-column-resizer-owner"/);
  });

  it("does not render the directory tree sidebar", () => {
    const markup = renderToStaticMarkup(
      createElement(FileBrowserDrawer, {
        open: true,
        scopeKey: "test-scope",
        defaultPath: "/workspace",
        sshHosts: [],
        selectedHost: { type: "local" },
        onSelectHost: () => {},
      }),
    );

    assert.doesNotMatch(markup, /file-browser-tree/);
    assert.doesNotMatch(markup, /目录树/);
  });

  it("provides a full-height inline preview state without changing mobile styles", () => {
    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

    assert.match(
      css,
      /\.file-browser-content--preview-open \.file-browser-list[\s\S]*?display:\s*none/,
    );
    assert.match(css, /\.file-browser-inline-back[\s\S]*?min-height:\s*28px/);
    assert.doesNotMatch(css, /\.mobile-file-browser[^}]*display:\s*none/);
  });
});
