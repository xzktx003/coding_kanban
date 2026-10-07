import { expect, it } from "vitest";
import { buildVisualizationDocument } from "./visualization-document";
it("provides an isolated runtime and escapes host configuration", () => {
  const value = buildVisualizationDocument(
    '<button data-lucide="plus">demo</button>',
    {
      nonce: "fixture",
      theme: { "--background": "</script><script>bad()</script>" },
      icons: {},
    },
  );
  expect(value).toContain("connect-src 'none'");
  expect(value).toContain("frame-src 'none'");
  expect(value).toContain("form-action 'none'");
  expect(value).toContain("viz-carousel-controls");
  expect(value).toContain("session-visualization-size");
  expect(value).toContain("demo");
  expect(value).not.toContain("</script><script>bad()");
  expect(value).toContain("\\u003c/script>");
});
