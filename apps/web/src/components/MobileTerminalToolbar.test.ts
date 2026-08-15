import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MobileTerminalShortcutHelp,
  MobileTerminalToolbar,
} from "./MobileTerminalToolbar.js";

describe("MobileTerminalToolbar", () => {
  it("renders a shortcut help button beside terminal controls", () => {
    const markup = renderToStaticMarkup(
      createElement(MobileTerminalToolbar, {
        onSendInput: () => {},
      }),
    );

    assert.match(markup, /aria-label="手机终端快捷键"/);
    assert.match(markup, /aria-controls="mobile-terminal-shortcut-help"/);
    assert.match(markup, />说明<\/button>/);
    assert.match(markup, /aria-pressed="false"[^>]*>Shift<\/button>/);
    assert.match(markup, />Ctrl\+C<\/button>/);
    assert.match(markup, />⌫<\/button>/);
    assert.match(markup, />⇧Tab<\/button>/);
    assert.match(markup, />⇧Enter<\/button>/);
    assert.match(markup, />Ctrl\+Enter<\/button>/);
  });

  it("lists shortcut descriptions for mobile users", () => {
    const markup = renderToStaticMarkup(
      createElement(MobileTerminalShortcutHelp, {
        onClose: () => {},
      }),
    );

    assert.match(markup, /role="dialog"/);
    assert.match(markup, /aria-modal="true"/);
    assert.match(
      markup,
      /aria-labelledby="mobile-terminal-shortcut-help-title"/,
    );
    assert.match(markup, /快捷键说明/);
    assert.match(markup, /下一次快捷键启用 Shift/);
    assert.match(markup, /中断当前输出或命令/);
    assert.match(markup, /退出 TUI 当前状态/);
    assert.match(markup, /反向切换 TUI 焦点/);
    assert.match(markup, /插入换行/);
    assert.match(markup, /强制提交/);
    assert.match(markup, /清屏/);
  });
});
