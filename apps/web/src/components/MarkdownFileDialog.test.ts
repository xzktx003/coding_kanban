import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  clampMarkdownDialogSize,
  MarkdownFileDialog,
} from "./MarkdownFileDialog.js";

test("renders a large Markdown browsing and editing dialog", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownFileDialog, {
      content: "# Dialog preview",
      dirty: false,
      fileName: "README.md",
      mode: "preview",
      onClose: () => {},
      onContentChange: () => {},
      onModeChange: () => {},
      onSave: () => {},
      saving: false,
    }),
  );

  assert.match(markup, /data-testid="markdown-file-dialog"/);
  assert.match(markup, /file-browser-modal--markdown/);
  assert.match(markup, /data-resizable="true"/);
  assert.match(markup, /README\.md/);
  assert.match(markup, /<h1>Dialog preview<\/h1>/);
  assert.match(markup, /aria-label="关闭 Markdown 文件窗口"/);
  assert.match(markup, /data-testid="markdown-mode-edit"/);
  assert.match(markup, /data-testid="markdown-mode-split"/);
  assert.match(markup, /data-testid="markdown-dialog-resizer"/);
  assert.match(markup, /aria-label="调整 Markdown 窗口大小"/);
});

test("keeps the Markdown dialog resizable within the viewport", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  const desktopRule = css.match(
    /\.file-browser-dialog--markdown\s*\{([^}]+)\}/,
  )?.[1];

  assert.ok(desktopRule);
  assert.match(desktopRule, /position:\s*relative/);
  assert.match(desktopRule, /max-width:\s*calc\(100vw - 24px\)/);
  assert.match(desktopRule, /max-height:\s*calc\(var\(--app-height\) - 24px\)/);
  assert.match(
    css,
    /\.file-browser-modal--markdown\s*\{[^}]*position:\s*fixed/,
  );
});

test("clamps dragged Markdown dialog sizes to usable viewport bounds", () => {
  assert.deepEqual(clampMarkdownDialogSize(1280, 900, 1440, 1000), {
    width: 1280,
    height: 900,
  });
  assert.deepEqual(clampMarkdownDialogSize(2000, 1200, 1440, 1000), {
    width: 1416,
    height: 976,
  });
  assert.deepEqual(clampMarkdownDialogSize(200, 180, 1440, 1000), {
    width: 560,
    height: 420,
  });
  assert.deepEqual(clampMarkdownDialogSize(200, 180, 520, 360), {
    width: 496,
    height: 336,
  });
});
