import { expect, it } from "vitest";
import { nativeMessageClipboard } from "./nativeMessageClipboard";
it("copies rendered message structure and strips UI attributes and controls", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="blocks"><p><strong>Bold 中文</strong></p>\n<ul>\n<li>First</li><li>Second <code data-streamdown="inline-code">code</code></li></ul><p><a href="https://example.com" class="link" onclick="bad()"><span><span>Link</span></span><span data-markdown-copy="exclude">icon</span></a></p></div>';
  expect(nativeMessageClipboard(root)).toEqual({
    text: "Bold 中文\n- First\n- Second code\nLink",
    html: '<div><p><strong><span>Bold 中文</span></strong></p><ul><li><span>First</span></li><li><span>Second </span><code dir="ltr">code</code></li></ul><p><a href="https://example.com"><span><span><span>Link</span></span></span></a></p></div>',
  });
});
it("preserves nested numbering, checked tasks, TSV cells and unhighlighted code", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<ol start="3"><li>Third<ul><li>nested</li></ul></li><li value="7"><input type="checkbox" checked> Task</li></ol><div><table><tbody><tr><td>a</td><td>b<br>c</td></tr></tbody></table></div><div data-streamdown="code-block"><div data-markdown-copy="exclude">Copy</div><pre><code><span>let </span>x = 1;</code></pre></div>';
  const payload = nativeMessageClipboard(root)!;
  expect(payload.text).toBe(
    "3. Third\n   - nested\n7. [x] Task\na\tb\nc\nlet x = 1;",
  );
  expect(payload.html).toContain(
    '<pre dir="ltr"><code>let x = 1;</code></pre>',
  );
  expect(payload.html).not.toContain("Copy");
});
it("ignores excluded or image-only content and retains citation copy labels", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<button data-markdown-copy-text="source.ts (L2–3)">short</button><span aria-hidden="true">hidden</span><span class="sr-only">hidden</span>';
  expect(nativeMessageClipboard(root)?.text).toBe("source.ts (L2–3)");
  root.innerHTML = '<img alt="" src="https://example.com/icon.png">';
  expect(nativeMessageClipboard(root)).toBeNull();
});

it("copies original LaTeX delimiters from KaTeX without duplicated hidden trees", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<p>Inline <span class="katex"><span aria-hidden="true">rendered</span><annotation encoding="application/x-tex">x^2</annotation></span></p><span class="katex-display"><span class="katex"><annotation encoding="application/x-tex">y</annotation></span></span>';
  expect(nativeMessageClipboard(root)?.text).toBe(
    "Inline \\(x^2\\)\n\\[\ny\n\\]",
  );
  expect(nativeMessageClipboard(root)?.html).toContain(
    'data-math-display="true"',
  );
});
it("normalizes fully typeset inline math to native LaTeX delimiters", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<p><span class="katex"><annotation encoding="application/x-tex">y</annotation></span></p>';
  expect(nativeMessageClipboard(root)).toEqual({
    text: "\\(y\\)",
    html: '<p><span data-math-source="y" data-math-display="false">\\(y\\)</span></p>',
  });
});
