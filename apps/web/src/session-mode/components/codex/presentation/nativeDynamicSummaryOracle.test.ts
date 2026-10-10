import { expect, it } from "vitest";
import oracle from "./fixtures/nativeDynamicSummaryOracle.json";
import { nativeDynamicToolCompletedSummaryKey } from "./nativeDynamicToolSemantics";
import { nativeCodexToolPresentation } from "./nativeToolSemantics";

it("matches the actual native cr and Ft outputs captured in the original read-only VSIX browser", () => {
  expect(oracle).toHaveLength(589);
  for (const row of oracle) {
    expect(
      nativeDynamicToolCompletedSummaryKey(row.item),
      JSON.stringify(row.item),
    ).toBe(row.key);
    if (row.item.namespace !== "codex_app" && row.item.namespace != null)
      continue;
    for (const [leading, expected] of [
      [true, row.leading],
      [false, row.following],
    ] as const) {
      const actual = nativeCodexToolPresentation(row.item, undefined, leading);
      expect(
        actual
          ? { id: actual.descriptorId, key: actual.key, state: actual.state }
          : null,
        JSON.stringify(row.item),
      ).toEqual(expected);
    }
  }
});
