import { describe, expect, it } from "vitest";
import {
  canonicalCodeLanguage,
  codeLanguageLabel,
  detectCodeLanguage,
} from "./codeLanguages";

describe("composer code languages", () => {
  it("maps plugin aliases and keeps unknown fences", () => {
    expect(canonicalCodeLanguage("tsx")).toBe("typescript");
    expect(canonicalCodeLanguage("text")).toBe("plaintext");
    expect(codeLanguageLabel("rs")).toBe("Rust");
    expect(codeLanguageLabel("madeup")).toBe("madeup");
  });

  it("detects json and leaves blank code unset", () => {
    expect(detectCodeLanguage("")).toBeNull();
    expect(detectCodeLanguage('{ "a": 1 }')).toBe("json");
    expect(detectCodeLanguage("fn main() {}")).toBe("rust");
    expect(detectCodeLanguage("hello")).toBeNull();
  });
});
