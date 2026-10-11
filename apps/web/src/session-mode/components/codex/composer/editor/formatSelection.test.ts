import { describe, expect, it } from "vitest";
import { formatDraftRange, formatSelection } from "./formatSelection";

describe("composer format toolbar", () => {
  it("wraps bold and italic and rejects a collapsed selection", () => {
    expect(formatSelection("ell", "bold")).toBe("**ell**");
    expect(formatSelection("", "italic")).toBeNull();
  });

  it("prefixes the selected lines and strips them back to a paragraph", () => {
    expect(formatSelection("one\ntwo", "ol")).toBe("1. one\n2. two");
    expect(formatSelection("# title", "paragraph")).toBe("title");
  });

  it("requires an http link", () => {
    expect(formatSelection("docs", "link", "ftp://x")).toEqual({
      error: "输入 HTTP 或 HTTPS 链接",
    });
    expect(formatSelection("docs", "link", "https://example.com")).toBe(
      "[docs](https://example.com)",
    );
  });

  it("numbers the selected lines and the current line at a caret", () => {
    expect(formatDraftRange("alpha\nbeta", 0, 10, "ol")).toEqual({
      value: "1. alpha\n2. beta",
      start: 0,
      end: 16,
    });
    expect(formatDraftRange("alpha\nbeta\ngamma", 7, 7, "ol")).toEqual({
      value: "alpha\n1. beta\ngamma",
      start: 6,
      end: 13,
    });
    expect(formatDraftRange("alpha\nbeta", 0, 10, "ul")).toEqual({
      value: "- alpha\n- beta",
      start: 0,
      end: 14,
    });
  });

  it("toggles checklist marks on and off", () => {
    expect(formatDraftRange("先看范围\n再改代码", 0, 9, "check")).toEqual({
      value: "- [ ] 先看范围\n- [ ] 再改代码",
      start: 0,
      end: 21,
    });
    expect(formatDraftRange("- [ ] 先看范围\n- [x] 再改代码", 0, 21, "check")).toEqual({
      value: "先看范围\n再改代码",
      start: 0,
      end: 9,
    });
  });
});
