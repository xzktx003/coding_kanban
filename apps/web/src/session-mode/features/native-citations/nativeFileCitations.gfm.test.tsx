import { render } from "@testing-library/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { expect, it } from "vitest";
import { remarkNativeFileCitations } from "./nativeFileCitations";

type AstNode = {
  type: string;
  value?: string;
  url?: string;
  children?: AstNode[];
  data?: { hProperties?: Record<string, string> };
};
function parsed(source: string, capturedSource = source): AstNode {
  let result: AstNode | undefined;
  const inspect = () => (tree: AstNode) => {
    result = structuredClone(tree);
  };
  render(
    <Markdown
      remarkPlugins={[
        remarkGfm,
        remarkNativeFileCitations(capturedSource),
        inspect,
      ]}
    >
      {source}
    </Markdown>,
  );
  return result!;
}
function descendants(tree: AstNode, type: string): AstNode[] {
  return (tree.type === type ? [tree] : []).concat(
    (tree.children ?? []).flatMap((child) => descendants(child, type)),
  );
}
it("consumes one complete native external directive split by real GFM autolinking", () => {
  const source =
    'Before :codex-file-citation{path="https://example.invalid/source" label="Source label"} after';
  const tree = parsed(source);
  const citations = descendants(tree, "nativeFileCitation");
  expect(citations).toHaveLength(1);
  expect(
    JSON.parse(citations[0].data!.hProperties!["data-native-file-citation"]),
  ).toEqual({
    kind: "external",
    path: "https://example.invalid/source",
    label: "Source label",
  });
  expect(descendants(tree, "link")).toHaveLength(0);
  expect(descendants(tree, "text").map((node) => node.value)).toEqual([
    "Before ",
    " after",
  ]);
});
it("retains a bare URL following the directive and uses the actual block VFile", () => {
  const block =
    ':codex-file-citation{path="https://example.invalid/source" label="Source"} and https://example.invalid/ordinary';
  const tree = parsed(block, "A first paragraph.\n\n" + block);
  expect(descendants(tree, "nativeFileCitation")).toHaveLength(1);
  expect(descendants(tree, "link").map((node) => node.url)).toEqual([
    "https://example.invalid/ordinary",
  ]);
});
it("retains real Markdown links, angle autolinks and inline/fenced code", () => {
  const directive =
    ':codex-file-citation{path="https://example.invalid/source" label="Source"}';
  const source =
    "[" +
    directive +
    "](https://example.invalid/destination)\n\n<https://example.invalid/ordinary>\n\n`" +
    directive +
    "`\n\n```text\n" +
    directive +
    "\n```";
  const tree = parsed(source);
  expect(descendants(tree, "nativeFileCitation")).toHaveLength(0);
  expect(descendants(tree, "link")).toHaveLength(2);
  expect(descendants(tree, "inlineCode")).toHaveLength(1);
  expect(descendants(tree, "code")).toHaveLength(1);
});
it("does not consume escaped, partial or HTML/image-embedded directive examples", () => {
  const directive =
    ':codex-file-citation{path="https://example.invalid/source" label="Source"}';
  const tree = parsed(
    "\\" +
      directive +
      '\n\n:codex-file-citation{path="https://example.invalid/incomplete\n\n<div>' +
      directive +
      "</div>\n\n![" +
      directive +
      "](https://example.invalid/image.png)",
  );
  expect(descendants(tree, "nativeFileCitation")).toHaveLength(0);
  expect(descendants(tree, "image")).toHaveLength(1);
});
