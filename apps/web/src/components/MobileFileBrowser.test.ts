import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  classifyMobileFilePreview,
  formatMobileFilePreviewRange,
  MobileFileBrowser,
  normalizeMobileNewEntryName,
  resolveMobileMarkdownDisplayKind,
} from "./MobileFileBrowser.js";

const markdownEntry = {
  name: "README.MD",
  path: "/workspace/project/README.MD",
  type: "file" as const,
  size: 18,
  modifiedAt: "2026-08-16T08:00:00.000Z",
  owner: "codex",
  permissions: "-rw-r--r--",
  isHidden: false,
};

const textPreview = {
  path: markdownEntry.path,
  content: "# Mobile file view",
  encoding: "utf8" as const,
  truncated: false,
  size: 18,
  mimeType: "text/markdown",
  offset: 0,
  bytesRead: 18,
  previousOffset: null,
  nextOffset: null,
};

describe("MobileFileBrowser", () => {
  it("renders touch-friendly directory controls and a file list surface", () => {
    const markup = renderToStaticMarkup(
      createElement(MobileFileBrowser, {
        session: {
          id: "mobile-files",
          workspaceId: "default",
          sourceType: "local",
          agentKind: "codex",
          displayName: "Mobile files",
          workingDirectory: "/workspace/project",
          projectName: "Project",
          connectionState: "online",
          interactionState: "idle",
        },
        onBack: () => {},
      }),
    );

    assert.match(markup, /aria-label="手机文件系统"/);
    assert.match(markup, />返回项目<\/button>/);
    assert.match(markup, />主目录<\/button>/);
    assert.match(markup, />上一级<\/button>/);
    assert.match(markup, />刷新<\/button>/);
    assert.match(markup, /aria-label="筛选文件"/);
    assert.match(markup, /显示隐藏文件/);
    assert.match(markup, /\/workspace\/project/);

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.mobile-project-card-controls button,\s*\.mobile-file-browser-control,\s*\.mobile-file-browser-state button\s*{[^}]*min-height:\s*44px;/s,
    );
    assert.match(css, /\.mobile-file-entry\s*{[^}]*min-height:\s*56px;/s);
  });

  it("routes Markdown through the rendered preview and keeps documents vertically scrollable", () => {
    assert.equal(
      classifyMobileFilePreview(markdownEntry, textPreview),
      "markdown",
    );
    assert.equal(
      classifyMobileFilePreview(
        { ...markdownEntry, name: "notes.txt" },
        { ...textPreview, mimeType: "text/plain" },
      ),
      "text",
    );
    assert.equal(
      resolveMobileMarkdownDisplayKind("markdown", "rendered"),
      "markdown",
    );
    assert.equal(
      resolveMobileMarkdownDisplayKind("markdown", "source"),
      "text",
    );
    assert.equal(resolveMobileMarkdownDisplayKind("image", "source"), "image");

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.mobile-workbench-content:has\(\.mobile-file-preview\)\s*{[^}]*overflow-y:\s*hidden;/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview\s*{[^}]*grid-template-rows:[^;]*minmax\(0,\s*1fr\);[^}]*height:\s*100%;/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview-content\s*{[^}]*grid-area:\s*content;[^}]*height:\s*auto;[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview-markdown\s*{[^}]*overflow-wrap:\s*anywhere;/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview-mode\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview-mode button\s*{[^}]*min-height:\s*44px;/s,
    );

    const source = readFileSync(
      new URL("./MobileFileBrowser.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /aria-label="Markdown 查看方式"/);
    assert.match(source, /aria-pressed={markdownViewMode === "rendered"}/);
    assert.match(source, /aria-pressed={markdownViewMode === "source"}/);
  });

  it("describes the active bounded window instead of claiming only the prefix is available", () => {
    assert.equal(
      formatMobileFilePreviewRange({
        ...textPreview,
        size: 196_608,
        offset: 65_536,
        bytesRead: 65_536,
        previousOffset: 0,
        nextOffset: 131_072,
        truncated: true,
      }),
      "64.0 KB–128.0 KB / 192.0 KB",
    );

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(css, /\.mobile-file-preview-pagination\s*{/);
  });

  it("collapses secondary file controls by default so the document keeps the available height", () => {
    const source = readFileSync(
      new URL("./MobileFileBrowser.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /\[previewControlsExpanded, setPreviewControlsExpanded\] =\s*useState\(false\)/,
    );
    assert.match(source, /aria-expanded={previewControlsExpanded}/);
    assert.match(source, /aria-controls="mobile-file-preview-controls"/);
    assert.match(source, /previewControlsExpanded && \(/);

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.mobile-file-preview\s*{[^}]*grid-template-areas:[^;]+"header"[^;]+"content"[^;]*;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview--controls-expanded\s*{[^}]*grid-template-areas:[^;]+"controls"[^;]+;[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview-controls\s*{[^}]*grid-area:\s*controls;[^}]*max-height:[^;]+;[^}]*overflow-y:\s*auto;/s,
    );
  });

  it("opens the desktop-equivalent file actions from a touch long press", () => {
    const source = readFileSync(
      new URL("./MobileFileBrowser.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /MOBILE_FILE_LONG_PRESS_MS\s*=\s*600/);
    assert.match(source, /onPointerDown=.*startFileLongPress/s);
    assert.match(source, /onPointerMove={moveFileLongPress}/);
    assert.match(source, /onPointerCancel={cancelFileLongPress}/);
    assert.match(source, /onContextMenu=/);
    assert.match(source, /aria-label="文件操作菜单"/);
    assert.match(source, />\s*复制路径\s*</);
    assert.match(source, />\s*下载\s*</);
    assert.match(source, />\s*重命名\s*</);
    assert.match(source, />\s*删除\s*</);

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.mobile-file-context-backdrop\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s,
    );
    assert.match(
      css,
      /\.mobile-file-context-menu\s*{[^}]*position:\s*absolute;[^}]*bottom:/s,
    );
  });

  it("creates files and folders from a touch-friendly new-entry menu", () => {
    assert.equal(normalizeMobileNewEntryName("  notes.md  "), "notes.md");
    assert.equal(normalizeMobileNewEntryName(""), null);
    assert.equal(normalizeMobileNewEntryName("."), null);
    assert.equal(normalizeMobileNewEntryName(".."), null);
    assert.equal(normalizeMobileNewEntryName("nested/file"), null);
    assert.equal(normalizeMobileNewEntryName("nested\\file"), null);

    const markup = renderToStaticMarkup(
      createElement(MobileFileBrowser, {
        session: {
          id: "mobile-create",
          workspaceId: "default",
          sourceType: "local",
          agentKind: "codex",
          displayName: "Mobile create",
          workingDirectory: "/workspace/project",
          connectionState: "online",
          interactionState: "idle",
        },
        onBack: () => {},
      }),
    );
    assert.match(markup, />新建<\/button>/);

    const source = readFileSync(
      new URL("./MobileFileBrowser.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /aria-label="新建文件或文件夹"/);
    assert.match(source, /createFile\(name\)/);
    assert.match(source, /createFolder\(name\)/);
    assert.match(source, />\s*新建文件\s*</);
    assert.match(source, />\s*新建文件夹\s*</);

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.mobile-file-browser-pathbar > div\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\);/s,
    );
  });
});
