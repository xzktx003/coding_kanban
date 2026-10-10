import { expect, it } from "vitest";
import { nativeFenceHighlight } from "./nativeFenceHighlight";

const highlight = (code: string, language: string) =>
  new Promise<string>((resolve) => {
    const result = nativeFenceHighlight.highlight({ code, language }, resolve);
    if (result !== null) resolve(result);
  });

it("uses the native TypeScript semantic spans and exact source escaping", async () => {
  expect(
    await highlight(
      "export function add(a: number, b: number) {\n  return a + b;\n}",
      "typescript",
    ),
  ).toBe(
    '<span class="hljs-keyword">export</span> <span class="hljs-keyword">function</span> <span class="hljs-title function_">add</span>(<span class="hljs-params"><span class="hljs-attr">a</span>: <span class="hljs-built_in">number</span>, <span class="hljs-attr">b</span>: <span class="hljs-built_in">number</span></span>) {\n  <span class="hljs-keyword">return</span> a + b;\n}',
  );
  expect(
    await highlight(
      '<img src=x onerror="alert(1)"><script>bad()</script>',
      "unknown-fixture",
    ),
  ).toBe(
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;bad()&lt;/script&gt;",
  );
});

it("retains the original custom TSRX grammar and registry aliases", async () => {
  const source = "const element = <Widget value={42} />;";
  expect(await highlight(source, "tsrx")).toContain("hljs-name");
  expect(await highlight("const value = 42", "recharts")).toBe(
    await highlight("const value = 42", "typescript"),
  );
  expect(await highlight("<div>text</div>", "vue")).toBe(
    await highlight("<div>text</div>", "xml"),
  );
});
