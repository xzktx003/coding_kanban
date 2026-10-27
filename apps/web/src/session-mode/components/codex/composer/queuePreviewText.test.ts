import { expect, it } from "vitest";
import { queuePreviewText, queuePreviewLabel } from "./queuePreviewText";
it("preserves ordinary Markdown and flattens a leading code block only for the summary", () => {
  expect(queuePreviewText({ text: "# **Keep** markup", images: [] })).toBe(
    "# **Keep** markup",
  );
  expect(
    queuePreviewText({
      text: "```ts\nconst x = 1;\n```\n\nNext **step**",
      images: [],
    }),
  ).toBe("const x = 1; Next step");
});
it("does not label file-only and reference-only messages as images", () => {
  expect(
    queuePreviewText({
      text: "",
      images: [],
      contexts: [
        { id: "f", kind: "file", name: "example.ts", text: "private snapshot" },
      ],
    }),
  ).toBe("1 个文件：example.ts");
  expect(
    queuePreviewText({
      text: " ",
      images: [],
      contexts: [
        { id: "q", kind: "quote", name: "response", text: "captured" },
      ],
    }),
  ).toBe("1 个已选文本片段");
  expect(queuePreviewText({ text: "", images: ["a", "b"] })).toBe("2 张图像");
});
it("shows the captured paste preview and counts other pastes", () => {
  expect(
    queuePreviewText({
      text: "",
      images: [],
      contexts: [
        { id: "a", kind: "paste", name: "a", text: "Keep original" },
        { id: "b", kind: "paste", name: "b", text: "Second" },
      ],
    }),
  ).toBe("Keep original (+其余 1 个粘贴文本附件)");
});

it("bounds the accessible excerpt without splitting emoji or retaining line breaks", () => {
  const emoji = "👨‍👩‍👧‍👦";
  expect(queuePreviewLabel(emoji.repeat(81))).toBe(emoji.repeat(79) + "…");
  expect(queuePreviewLabel(" first \n second ")).toBe("first second");
});

it("matches bounded native paste previews without changing captured text", () => {
  const text = "  first\n   " + "x".repeat(180_000);
  const context = { id: "paste", kind: "paste" as const, name: "paste", text };
  expect(queuePreviewText({ text: "", images: [], contexts: [context] })).toBe(
    "first " + "x".repeat(73) + "…",
  );
  expect(context.text).toBe(text);
  expect(
    queuePreviewText({
      text: "",
      images: [],
      contexts: [{ ...context, text: " \n " }],
    }),
  ).toBe("粘贴的文本");
});
it("counts captured ranges and quotes as selections while retaining whole-file details", () => {
  expect(
    queuePreviewText({
      text: "",
      images: ["image"],
      contexts: [
        { id: "f", kind: "file", name: "whole.ts", text: "whole file" },
        {
          id: "r",
          kind: "file",
          name: "range.ts",
          range: { start: 1, end: 2 },
          text: "selection",
        },
        { id: "q", kind: "quote", name: "answer", text: "quoted response" },
      ],
    }),
  ).toBe("1 个文件：whole.ts · 2 个已选文本片段");
});
