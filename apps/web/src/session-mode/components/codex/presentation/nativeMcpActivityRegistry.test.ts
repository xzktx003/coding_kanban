import { expect, it } from "vitest";
import oracle from "./fixtures/nativeMcpActivityOracle.json";
import { nativeMcpActivityDescriptor } from "./nativeMcpActivityRegistry.js";
it("matches 1,956 actual original connector context/schema/preview/count selections across 12 families", () => {
  const families = new Set<string>();
  for (const row of oracle.cases) {
    families.add(row.connector);
    const actual = nativeMcpActivityDescriptor(
      {
        id: `connector_${row.connector}`,
        name: row.connector.replaceAll("_", " "),
        pluginDisplayNames: [],
      },
      row.tool,
      oracle.arguments[row.argumentCase],
      oracle.result,
      row.completed,
    );
    expect(
      actual,
      `${row.connector}/${row.tool} arguments=${row.argumentCase} completed=${row.completed}`,
    ).toEqual(row.expected);
  }
  expect(oracle.cases).toHaveLength(1956);
  expect(families.size).toBe(12);
});
