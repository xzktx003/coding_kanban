import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  classifyMobileFilePreview,
  MobileFileBrowser,
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

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.mobile-file-preview-content\s*{[^}]*height:\s*clamp\([^;]+;[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s,
    );
    assert.match(
      css,
      /\.mobile-file-preview-markdown\s*{[^}]*overflow-wrap:\s*anywhere;/s,
    );
  });
});
