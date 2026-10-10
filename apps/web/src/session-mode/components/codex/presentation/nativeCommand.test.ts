import { expect, it } from "vitest";
import {
  normalizeNativeCommand,
  nativeShellName,
  commandDurationLabel,
  ansiSegments,
} from "./nativeCommand";

it("uses the native display-only shell wrapper normalization", () => {
  expect(normalizeNativeCommand("/bin/zsh -lc 'echo hello'")).toBe(
    "echo hello",
  );
  expect(normalizeNativeCommand('$ bash -lc "echo \\"hello\\""')).toBe(
    'echo "hello"',
  );
  expect(normalizeNativeCommand("python -c 'print(1)'")).toBe(
    "python -c 'print(1)'",
  );
  expect(nativeShellName("/bin/zsh -lc 'echo hello'")).toBe("zsh");
  expect(nativeShellName("python --version")).toBeNull();
  expect(commandDurationLabel(Number.NaN)).toBeNull();
  expect(commandDurationLabel(-1)).toBeNull();
  expect(commandDurationLabel(9400)).toBe("9s");
  expect(commandDurationLabel(999)).toBeNull();
  expect(commandDurationLabel(86400000)).toBe("1d 0h 0m 0s");
});

it("renders safe terminal text with native ANSI classes, decoration reset, and carriage-return overwrite", () => {
  const parts = ansiSegments(
    "\u001b[32m<b>pass</b>\u001b[0m\n12345\rxy\nabc\bZ\u001b[2K",
  );
  expect(parts.map((p) => p.text).join("")).toBe("<b>pass</b>\nxy345\nabZ");
  expect(parts.find((p) => p.text.includes("<b>pass"))?.className).toContain(
    "ansi-green-fg",
  );
  expect(parts.at(-1)?.className ?? "").not.toContain("ansi-green-fg");
  expect(ansiSegments("\u001b[1mbold\u001b[22mplain")).toMatchObject([
    { text: "bold", style: { fontWeight: "bold" } },
    { text: "plain" },
  ]);
  expect(
    ansiSegments("\u001b]8;;javascript:alert(1)\u0007safe\u001b]8;;\u0007")
      .map((p) => p.text)
      .join(""),
  ).toBe("safe");
});
