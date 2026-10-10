import { expect, it } from "vitest";
import { parseNativeReviewFindings } from "./nativeReviewFindings";

it("reads actual native code-comment directives with literal paths and bounded coordinates", () => {
  const result = parseNativeReviewFindings('Review body\n::code-comment{title="Lost tail" body="Use \\"last\\" entry." file="/owner/100%:12.ts" start=80 end=82 priority=1}\n', "/owner");
  expect(result.markdown).toBe("Review body\n");
  expect(result.findings).toEqual([{ id: expect.any(String), title: "[P1] Lost tail", body: 'Use "last" entry.', path: "/owner/100%:12.ts", start: 80, end: 82, side: "new", priority: 1 }]);
});
it("never treats fenced code, malformed or unknown directives as hidden instructions", () => {
  const text = '```md\n::code-comment{title="sample" body="example" file="a.ts"}\n```\n    ::code-comment{title="indented" body="example" file="a.ts"}\n::code-comment{title="broken"}\n';
  expect(parseNativeReviewFindings(text, "/owner")).toEqual({ markdown: text, findings: [] });
});
it("deduplicates by finding identity, normalizes native start/end and rejects nonlocal URLs", () => {
  const directive = '::code-comment{title="[P2] Keep state" body="Restore state." file="a.ts" start=8 end=2 priority=1}';
  const result = parseNativeReviewFindings([directive, directive, '::code-comment{title="remote" body="bad" file="https://other/a.ts"}'].join("\n"), "/owner");
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toMatchObject({ title: "[P2] Keep state", start: 8, end: 8, path: "/owner/a.ts" });
  expect(result.markdown).toContain('file="https://other/a.ts"');
});
