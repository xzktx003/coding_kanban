import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FileBrowserDrawer } from "./FileBrowserDrawer.js";

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
});
