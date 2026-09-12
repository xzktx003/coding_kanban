import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TerminalConnectionFeedback } from "./TerminalConnectionFeedback.js";

test("terminal connection feedback stays hidden after replay is ready", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(TerminalConnectionFeedback, {
        phase: "connected",
        onRetry: () => {},
      }),
    ),
    "",
  );
});

test("terminal connection feedback exposes a visible retry after failure", () => {
  const html = renderToStaticMarkup(
    createElement(TerminalConnectionFeedback, {
      phase: "reconnecting",
      onRetry: () => {},
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /终端连接失败，正在重试/);
  assert.match(html, /立即重试/);
  assert.match(html, /type="button"/);
});
