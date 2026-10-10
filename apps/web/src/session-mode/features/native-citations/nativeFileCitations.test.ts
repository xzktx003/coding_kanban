import { describe, expect, it } from "vitest";
import {
  decodeNativeFileCitation,
  parseNativeFileCitationAttributes,
  parseNativeFileCitations,
  remarkNativeFileCitations,
} from "./nativeFileCitations";

describe("native file citations from enabled local Agent messages", () => {
  it("parses native attributes and keeps the complete source line range", () => {
    expect(
      parseNativeFileCitationAttributes({
        path: " src/owned.ts ",
        line_range_start: "12",
        line_range_end: "18",
        purpose: "evidence",
        label: "Owned source",
      }),
    ).toEqual({
      kind: "file",
      path: "src/owned.ts",
      lineStart: 12,
      lineEnd: 18,
      purpose: "evidence",
      label: "Owned source",
    });
    expect(
      parseNativeFileCitationAttributes({
        path: "C:\\repo\\file.ts",
        lineRangeStart: "3",
        lineRangeEnd: "7",
      }),
    ).toEqual({
      kind: "file",
      path: "C:\\repo\\file.ts",
      lineStart: 3,
      lineEnd: 7,
    });
  });
  it("keeps literal filename suffixes and percent characters", () => {
    expect(
      parseNativeFileCitationAttributes({ path: "src/100%23owned:20.ts" })
        ?.path,
    ).toBe("src/100%23owned:20.ts");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "mailto:a@b",
    "ftp://remote/file",
    "http://",
    "",
    "\u0000file",
  ])("rejects unsafe or invalid targets: %s", (path) => {
    expect(parseNativeFileCitationAttributes({ path })).toBeNull();
  });
  it("retains ordinary HTTP sources but never invents live-artifact navigation", () => {
    expect(
      parseNativeFileCitationAttributes({
        path: "https://example.invalid/source",
        title: "Source",
      }),
    ).toEqual({
      kind: "external",
      path: "https://example.invalid/source",
      label: "Source",
    });
    expect(
      parseNativeFileCitationAttributes({
        path: "artifact-session-id",
        mode: "live",
        artifact_kind: "workbook",
      }),
    ).toBeNull();
  });
  it.each(["0", "-3", "Infinity", "12garbage", "9007199254740992"])(
    "does not create a navigation coordinate from %s",
    (line) => {
      expect(
        parseNativeFileCitationAttributes({
          path: "/owned/file",
          line_range_start: line,
        }),
      ).toBeNull();
    },
  );
  it("scans complete native directives and reports UTF-16 source boundaries", () => {
    const directive =
      ':codex-file-citation{path="src/a.ts" line_range_start=3 line_range_end="8"}';
    const source = "😀 Before " + directive + " after";
    expect(parseNativeFileCitations(source)).toEqual([
      {
        sourceStart: source.indexOf(":"),
        sourceEnd: source.indexOf(":") + directive.length,
        matchedText: directive,
        citation: { kind: "file", path: "src/a.ts", lineStart: 3, lineEnd: 8 },
      },
    ]);
    expect(
      parseNativeFileCitations(':codex-file-citation{path="src/stream'),
    ).toEqual([]);
  });
  it("handles quoted braces, escaped quotes, single quotes and a directive label", () => {
    expect(
      parseNativeFileCitations(
        ':codex-file-citation[Source]{path="src/a}b\\\"c.ts" title=\'Proof\'}',
      )[0]?.citation,
    ).toEqual({ kind: "file", path: 'src/a}b"c.ts', label: "Proof" });
  });
  it("supports native legacy absolute and F-prefixed file citations", () => {
    const source = "【/repo/src/a.ts†L12-L18】 and 【F:src/a%20b.ts†L3】";
    expect(
      parseNativeFileCitations(source).map((match) => match.citation),
    ).toEqual([
      { kind: "file", path: "/repo/src/a.ts", lineStart: 12, lineEnd: 18 },
      { kind: "file", path: "src/a b.ts", lineStart: 3 },
    ]);
    expect(
      parseNativeFileCitations(
        "【relative.ts†L3】 【turn0search0†L3】 【/file†L0】",
      ),
    ).toEqual([]);
  });
  it("keeps opaque ChatGPT citation IDs and escaped directives as text", () => {
    expect(
      parseNativeFileCitations(
        'citeturn0search0 fileciteturn0file0 \\:codex-file-citation{path="/file"}',
      ),
    ).toEqual([]);
    expect(
      parseNativeFileCitations('\\\\:codex-file-citation{path="/file"}'),
    ).toHaveLength(1);
  });
  it("honors excluded Markdown source ranges", () => {
    const source = ':codex-file-citation{path="/file"}';
    expect(
      parseNativeFileCitations(source, [{ start: 0, end: source.length }]),
    ).toEqual([]);
  });
  it("only decodes validated citation data, without prototype or host callbacks", () => {
    expect(
      decodeNativeFileCitation(
        '{"kind":"file","path":"/file","lineStart":2,"lineEnd":5}',
      ),
    ).toEqual({ kind: "file", path: "/file", lineStart: 2, lineEnd: 5 });
    expect(
      decodeNativeFileCitation('{"kind":"file","path":"javascript:alert(1)"}'),
    ).toBeNull();
    expect(decodeNativeFileCitation("invalid")).toBeNull();
  });
});

function textTree(source: string, type = "text", value = source) {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type,
            value,
            position: { start: { offset: 0 }, end: { offset: source.length } },
          },
        ],
      },
    ],
  };
}
describe("Markdown citation transform", () => {
  it("emits an inert typed inline node and retains surrounding text", () => {
    const source =
      'Before :codex-file-citation{path="/repo/a.ts" line_range_start=2 line_range_end=4} after';
    const tree = textTree(source);
    remarkNativeFileCitations(source)()(tree);
    const children = tree.children[0].children;
    expect(children).toEqual([
      expect.objectContaining({ type: "text", value: "Before " }),
      expect.objectContaining({
        type: "nativeFileCitation",
        data: {
          hName: "span",
          hProperties: {
            "data-native-file-citation": JSON.stringify({
              kind: "file",
              path: "/repo/a.ts",
              lineStart: 2,
              lineEnd: 4,
            }),
          },
        },
      }),
      expect.objectContaining({ type: "text", value: " after" }),
    ]);
  });
  it.each([
    "code",
    "inlineCode",
    "html",
    "image",
    "imageReference",
    "definition",
    "link",
    "linkReference",
  ])("does not interpret citations inside %s", (type) => {
    const source = ':codex-file-citation{path="/file"}';
    const tree = textTree(source, type);
    const before = structuredClone(tree);
    remarkNativeFileCitations(source)()(tree);
    expect(tree).toEqual(before);
  });
  it("preserves escaped literals adjacent to a real citation", () => {
    const literal = ':codex-file-citation{path="/file"}';
    const source = "\\" + literal + " and " + literal;
    const tree = textTree(source, "text", literal + " and " + literal);
    remarkNativeFileCitations(source)()(tree);
    expect(tree.children[0].children[0]).toMatchObject({
      type: "text",
      value: literal + " and ",
    });
    expect(tree.children[0].children[1]).toMatchObject({
      type: "nativeFileCitation",
    });
  });
  it("uses the actual VFile block when Streamdown resets source positions", () => {
    const block = ':codex-file-citation{path="/second.ts"}';
    const source = "First paragraph.\n\n" + block;
    const tree = textTree(block);
    remarkNativeFileCitations(source)()(tree, { value: block });
    expect(tree.children[0].children[0]).toMatchObject({
      type: "nativeFileCitation",
    });
  });
});
