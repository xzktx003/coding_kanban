import { expect, it } from "vitest";
import { splitVisualizationContent } from "./visualize-markers";
const marker =
  'visualize{"path":"/project/mock.html","mode":"wide","title":"草图"}';
it("separates complete references from surrounding Markdown", () => {
  expect(splitVisualizationContent("Before\n" + marker + "\nAfter")).toEqual([
    { kind: "markdown", text: "Before\n" },
    {
      kind: "visualization",
      reference: { path: "/project/mock.html", mode: "wide", title: "草图" },
    },
    { kind: "markdown", text: "\nAfter" },
  ]);
});
it("keeps fenced, indented and inline code examples literal", () => {
  for (const value of [
    "```text\n" + marker + "\n```",
    "~~~\n" + marker + "\n~~~",
    "`" + marker + "`",
    "    " + marker,
    "``" + marker + "``",
  ])
    expect(splitVisualizationContent(value)).toEqual([
      { kind: "markdown", text: value },
    ]);
});
it("waits for a streaming reference to finish and does not load malformed references", () => {
  expect(splitVisualizationContent('Before visualize{"path":')).toEqual([
    { kind: "markdown", text: "Before " },
    { kind: "pending" },
  ]);
  for (const data of [
    "{}",
    '{"path":"https://example.com/page.html"}',
    '{"path":"/project/.env"}',
    '{"path":"/project/../secret.html"}',
    '{"path":1}',
    "{bad json}",
  ]) {
    const value = "visualize" + data + "";
    expect(splitVisualizationContent(value)).toEqual([
      { kind: "markdown", text: value },
    ]);
  }
});
