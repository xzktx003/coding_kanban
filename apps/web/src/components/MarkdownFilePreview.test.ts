import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MarkdownFilePreview,
  normalizeLatexMathDelimiters,
} from "./MarkdownFilePreview.js";
import { MarkdownRenderedContent } from "./MarkdownRenderedContent.js";

const markdown = `# Project

- [x] Render Markdown
- [ ] Save changes

| Name | State |
| --- | --- |
| Preview | Ready |

[OpenAI](https://openai.com)

<script>alert("unsafe")</script>
`;

function renderMarkdownContent(content: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownRenderedContent, { content }),
  );
}

test("supports a reusable surface class without dropping shared Markdown styles", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownRenderedContent, {
      className: "agent-transcript-markdown",
      content: "**Rendered**",
    }),
  );

  assert.match(
    markup,
    /class="markdown-rendered-content agent-transcript-markdown"/,
  );
  assert.match(markup, /<strong>Rendered<\/strong>/);
});

test("renders GitHub-flavored Markdown safely in preview mode", () => {
  const markup = renderMarkdownContent(markdown);
  const controls = renderToStaticMarkup(
    createElement(MarkdownFilePreview, {
      content: markdown,
      dirty: false,
      mode: "preview",
      onContentChange: () => {},
      onModeChange: () => {},
      onSave: () => {},
      saving: false,
    }),
  );

  assert.match(markup, /<h1 id="markdown-heading-1">Project<\/h1>/);
  assert.match(markup, /type="checkbox"[^>]*checked/);
  assert.match(markup, /<table>/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.doesNotMatch(markup, / node=/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(controls, /data-testid="markdown-mode-preview"/);
  assert.match(controls, /data-testid="markdown-render(?:ed|-loading)"/);
});

test("renders inline and display LaTeX formulas with accessible MathML", () => {
  const formulaMarkdown = String.raw`Inline formula: $E = mc^2$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$`;
  const markup = renderMarkdownContent(formulaMarkdown);

  assert.match(markup, /class="katex"/);
  assert.match(markup, /class="katex-display"/);
  assert.match(markup, /<math/);
  assert.match(markup, /E/);
  assert.match(markup, /mc/);
  assert.match(markup, /∫/);
});

test("renders parenthesis and bracket LaTeX delimiters without changing code", () => {
  const formulaMarkdown = [
    String.raw`Inline formula: \(x_t + y_t\).`,
    "",
    String.raw`\[`,
    String.raw`y_t = \sum_{e \in R_t} g_{t,e} f_e(x_t)`,
    String.raw`\]`,
    "",
    "Inline code: `\\(not_math\\)`",
    "",
    "```text",
    String.raw`\[not_math\]`,
    "```",
  ].join("\n");
  const markup = renderMarkdownContent(formulaMarkdown);

  assert.equal((markup.match(/class="katex"/g) ?? []).length, 2);
  assert.match(markup, /class="katex-display"/);
  assert.match(markup, /\\\(not_math\\\)/);
  assert.match(markup, /\\\[not_math\\\]/);
});

test("normalizes alternate LaTeX delimiters only outside Markdown code", () => {
  const source = [
    "Text \\(x\\) and `\\(code\\)`.",
    String.raw`\[`,
    "y",
    String.raw`\]`,
    "```md",
    String.raw`\(fenced\)`,
    "```",
  ].join("\n");

  assert.equal(
    normalizeLatexMathDelimiters(source),
    [
      "Text $x$ and `\\(code\\)`.",
      "$$",
      "y",
      "$$",
      "```md",
      String.raw`\(fenced\)`,
      "```",
    ].join("\n"),
  );
});

test("keeps editing available while split preview loads on demand", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownFilePreview, {
      content: "# Live draft",
      dirty: true,
      mode: "split",
      onContentChange: () => {},
      onModeChange: () => {},
      onSave: () => {},
      saving: false,
    }),
  );

  assert.match(markup, /data-testid="markdown-editor"/);
  assert.match(markup, /# Live draft/);
  assert.match(markup, /data-testid="markdown-render(?:ed|-loading)"/);
  assert.match(markup, /未保存/);
  assert.match(markup, /data-testid="save-markdown"/);
  assert.match(markup, /aria-label="Markdown 目录"/);
  assert.match(markup, /data-testid="markdown-sync-scroll"/);
  assert.match(markup, /aria-pressed="true"/);
});

test("keeps large Markdown windows read-only while retaining split browsing", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownFilePreview, {
      content: "# Window",
      dirty: false,
      mode: "split",
      onContentChange: () => {},
      onModeChange: () => {},
      onSave: () => {},
      readOnly: true,
      saving: false,
    }),
  );

  assert.match(markup, /Markdown 源码编辑器[^>]*readOnly/);
  assert.match(markup, /分段预览只读/);
  assert.match(markup, /data-testid="markdown-mode-edit"[^>]*disabled/);
});

test("shows bounded Markdown window navigation without retaining every segment", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownFilePreview, {
      content: "# Current window",
      dirty: false,
      mode: "preview",
      onContentChange: () => {},
      onModeChange: () => {},
      onSave: () => {},
      readOnly: true,
      saving: false,
      windowNavigation: {
        label: "0 B–1.0 MB / 3.0 MB · 仅保留当前段",
        loading: false,
        nextAvailable: true,
        onNext: () => {},
        onPrevious: () => {},
        previousAvailable: false,
      },
    }),
  );

  assert.match(markup, /aria-label="Markdown 分段导航"/);
  assert.match(markup, />上一段<\/button>/);
  assert.match(markup, />下一段<\/button>/);
  assert.match(markup, /仅保留当前段/);
});

test("edit mode keeps the source editor without rendering the document body", () => {
  const markup = renderToStaticMarkup(
    createElement(MarkdownFilePreview, {
      content: "# Source only",
      dirty: false,
      mode: "edit",
      onContentChange: () => {},
      onModeChange: () => {},
      onSave: () => {},
      saving: false,
    }),
  );

  assert.match(markup, /data-testid="markdown-editor"/);
  assert.doesNotMatch(markup, /<h1>Source only<\/h1>/);
  assert.doesNotMatch(markup, /data-testid="markdown-render-loading"/);
});

test("memoizes the heavy Markdown renderer across unrelated board updates", () => {
  assert.equal(
    (MarkdownRenderedContent as unknown as { $$typeof: symbol }).$$typeof,
    Symbol.for("react.memo"),
  );
});
