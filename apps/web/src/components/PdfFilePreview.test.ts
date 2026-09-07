import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PdfFilePreview } from "./PdfFilePreview.js";

test("renders a reusable PDF preview surface while the blob loads", () => {
  const markup = renderToStaticMarkup(
    createElement(PdfFilePreview, {
      path: "/workspace/docs/report.pdf",
      sshTarget: { host: "example.test", port: 22 },
    }),
  );

  assert.match(markup, /class="pdf-file-preview"/);
  assert.match(markup, /data-testid="pdf-file-preview"/);
  assert.match(markup, /正在加载 PDF 预览/);
  assert.doesNotMatch(markup, /<iframe/);
});
