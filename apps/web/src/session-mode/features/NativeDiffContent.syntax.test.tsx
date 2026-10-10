import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const highlight = vi.hoisted(() => vi.fn((_options: { code: string }) => null));
vi.mock("@session/components/codex/presentation/codexCode", () => ({ codexCode: { supportsLanguage: () => true, getThemes: () => ["light", "dark"], highlight } }));
import { NativeDiffContent } from "./NativeDiffContent";
import { nativeDiffLines } from "./nativeDiffLines";
it("highlights old and new syntax independently so removed lexical state cannot corrupt additions", () => {
  render(<NativeDiffContent path="a.ts" lines={nativeDiffLines("", "", "@@ -80,2 +90,2 @@\n-/* old multiline start\n-removed\n+const value = 42;\n+console.log(value);\n")} />);
  expect(highlight.mock.calls.map(call => (call[0] as { code: string }).code)).toEqual(["/* old multiline start\nremoved", "const value = 42;\nconsole.log(value);"]);
});
