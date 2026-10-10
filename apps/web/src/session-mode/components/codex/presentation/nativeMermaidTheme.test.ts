import { expect, it } from "vitest";
import { nativeMermaidConfig } from "./nativeMermaidTheme";

it("applies the native improved theme only to the original flowchart branch", () => {
  const flowchart = nativeMermaidConfig(
    "dark",
    "%% comment\n\ngraph TD\n A --> B",
  );
  const sequence = nativeMermaidConfig(
    "light",
    "sequenceDiagram\n Alice->>Bob: hello",
  );
  expect(flowchart.layout).toBe("chatgpt-flowchart");
  expect(flowchart.themeCSS).toContain(".node text");
  expect(sequence.layout).toBe("codex-elk");
  expect(sequence.themeCSS).toBeUndefined();
  expect(sequence.themeVariables.primaryColor).toBe("rgb(229, 242, 255)");
});
