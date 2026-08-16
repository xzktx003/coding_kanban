import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MobileFileBrowser } from "./MobileFileBrowser.js";

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
});
