import { describe, expect, it } from "vitest";
import { composeContextText } from "@agent-orchestrator/shared";
import {
  isLargePaste,
  splitDraftBlocks,
  replaceDraftBlock,
  insertAtSelection,
} from "./content";

describe("composer context and lossless text", () => {
  it("folds only large pastes and keeps every character when sent", () => {
    expect(isLargePaste("a".repeat(2000))).toBe(false);
    expect(isLargePaste("a".repeat(2001))).toBe(true);
    expect(isLargePaste(Array(42).fill("line").join("\n"))).toBe(true);
    const text = "  ```nested```\r\n<script>literal</script>  ";
    expect(
      composeContextText("request", [
        { id: "paste", kind: "paste", name: "粘贴文本", text },
      ]),
    ).toContain(text);
  });
  it("restores a paste at the cursor without replacing the existing draft", () => {
    expect(insertAtSelection("prefix suffix", 6, 6, "\nlogs\n")).toBe(
      "prefix\nlogs\n suffix",
    );
    expect(insertAtSelection("keep this", 0, 4, "quoted")).toBe("quoted this");
  });
  it("round trips fences, blank lines and CRLF without HTML serialization", () => {
    const value =
      "before\r\n\r\n````typescript\r\nconst x = `nested`;\r\n````\r\nafter\n";
    const blocks = splitDraftBlocks(value);
    expect(blocks.map((b) => b.raw).join("")).toBe(value);
    const code = blocks.find((b) => b.kind === "code")!;
    expect(replaceDraftBlock(value, code, code.text)).toBe(value);
    expect(replaceDraftBlock(value, code, "const y = 2;\r\n")).toContain(
      "````typescript\r\nconst y = 2;\r\n````",
    );
  });
  it("leaves an unclosed fence editable as ordinary text", () => {
    const value = "a\n```ts\nunfinished";
    expect(splitDraftBlocks(value).every((b) => b.kind === "text")).toBe(true);
  });
  it("lengthens surrounding fences when edited code contains a closing fence", () => {
    const value = "before\n```text\ncode\n```\nafter";
    const block = splitDraftBlocks(value).find((b) => b.kind === "code")!;
    const updated = replaceDraftBlock(value, block, "example\n```\ninner\n");
    expect(
      splitDraftBlocks(updated).filter((b) => b.kind === "code"),
    ).toHaveLength(1);
    expect(splitDraftBlocks(updated).find((b) => b.kind === "code")?.text).toBe(
      "example\n```\ninner\n",
    );
  });
});
