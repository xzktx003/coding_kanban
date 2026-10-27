import { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mountSelection = vi.hoisted(() => ({ enabled: false }));
afterEach(() => {
  mountSelection.enabled = false;
});
vi.mock("./CodeLanguagePicker", () => ({ CodeLanguagePicker: () => null }));
vi.mock("./CodeBlockEditor", () => ({
  default: ({ value, onSelection }: any) => {
    useEffect(() => {
      if (mountSelection.enabled) onSelection(0, 0);
    }, []);
    return (
      <textarea
        aria-label="代码内容"
        value={value}
        readOnly
        onSelect={(e) =>
          onSelection(
            e.currentTarget.selectionStart,
            e.currentTarget.selectionEnd,
          )
        }
      />
    );
  },
}));
import { RichDraftEditor } from "./RichDraftEditor";
function mount(initial: string, plainInitial = true) {
  const change = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial),
      [plain, setPlain] = useState(plainInitial);
    return (
      <>
        <output data-testid="draft">{value}</output>
        <RichDraftEditor
          value={value}
          plain={plain}
          onPlainChange={setPlain}
          onChange={(v) => {
            change(v);
            setValue(v);
          }}
        />
      </>
    );
  }
  render(<Harness />);
  return change;
}
function select(start: number, end = start) {
  const el = screen.getByRole("textbox", {
    name: "展开的消息草稿",
  }) as HTMLTextAreaElement;
  el.focus();
  el.setSelectionRange(start, end);
  fireEvent.select(el);
  return el;
}
const insert = () =>
  fireEvent.click(screen.getByRole("button", { name: "插入代码块" }));
const value = () => screen.getByTestId("draft").textContent;
describe("expanded insert code block", () => {
  it("handles a selection with many independent backticks without argument overflow", () => {
    const text = "`x".repeat(150_000);
    mount(text);
    select(0, text.length);
    insert();
    expect(value()).toBe("```\n" + text + "\n```\n");
  });
  it("ignores an unfocused code editor mount selection", async () => {
    mountSelection.enabled = true;
    mount("```ts\nx\n```\n正文", false);
    await screen.findByRole("textbox", { name: "代码内容" });
    insert();
    expect(value()).toBe("```ts\nx\n```\n正文\n```\n\n```\n");
  });
  it("appends once without a recorded caret and adds a valid line boundary", () => {
    mount("原需求");
    insert();
    expect(value()).toBe("原需求\n```\n\n```\n");
  });
  it("inserts an empty block at a collapsed caret preserving both sides", () => {
    mount("前文后文");
    select(2);
    insert();
    expect(value()).toBe("前文\n```\n\n```\n后文");
  });
  it("wraps selected text once preserving both sides", () => {
    mount("前文代码后文");
    select(2, 4);
    insert();
    expect(value()).toBe("前文\n```\n代码\n```\n后文");
  });
  it("preserves CRLF and protects selected triple backticks with a longer fence", () => {
    mount("前\r\n```\r\n后");
    select(2, 5);
    insert();
    expect(value()).toBe("前\r\n````\r\n```\r\n````\r\n后");
  });
  it("does not mutate or switch mode during Chinese composition and accepts the committed range", () => {
    const change = mount("中文");
    const el = select(2);
    fireEvent.compositionStart(el);
    insert();
    fireEvent.click(screen.getByRole("button", { name: "切换代码模式" }));
    fireEvent.keyDown(el, {
      key: "5",
      ctrlKey: true,
      altKey: true,
      isComposing: true,
      keyCode: 229,
    });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "切换代码模式" })).toBeTruthy();
    fireEvent.change(el, {
      target: { value: "中文输入", selectionStart: 4, selectionEnd: 4 },
    });
    fireEvent.compositionEnd(el);
    select(4);
    insert();
    expect(value()).toBe("中文输入\n```\n\n```\n");
  });
  it("does not wrap existing code fences when a code editor selection is active", async () => {
    mount("前\n```ts\nx\n```\n后", false);
    const el = (await screen.findByRole("textbox", {
      name: "代码内容",
    })) as HTMLTextAreaElement;
    el.focus();
    el.setSelectionRange(0, 1);
    fireEvent.select(el);
    insert();
    expect(value()).toBe("前\n```ts\nx\n```\n```\n\n```\n后");
  });
});
