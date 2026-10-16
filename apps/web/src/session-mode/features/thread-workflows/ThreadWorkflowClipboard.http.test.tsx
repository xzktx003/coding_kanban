import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThreadWorkflowToolbar } from "./ThreadWorkflowToolbar";
import { ThreadEditRecovery } from "./ThreadEditRecovery";
import { threadWorkflowActions, useThreadWorkflowActions } from "./actions";
import { useThreadWorkflowStore } from "./delivery";

vi.mock("./service", () => ({ downloadThreadMarkdown: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh" } }),
}));
const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
beforeEach(() => {
  useThreadWorkflowActions.setState({
    panels: {},
    requests: {},
    focusRequests: {},
    moveRequests: {},
  });
  useThreadWorkflowStore.setState({ mutations: {}, inlineEdits: {} });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});
afterEach(() => {
  if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});

it.each(["copyMarkdown", "copyLink", "copyDeeplink"] as const)(
  "copies %s on HTTP without moving the draft selection",
  async (action) => {
    let copied = "";
    const exec = vi.fn(() => {
      copied = document.querySelector("textarea")!.value;
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: exec,
    });
    render(
      <>
        <input aria-label="Draft" defaultValue="keep draft" />
        <ThreadWorkflowToolbar
          threadId="owner"
          rows={[
            {
              rowId: "row",
              itemId: "user",
              turnId: "turn",
              role: "user",
              text: "exact 中文 source",
              completed: true,
            },
          ]}
          turns={[]}
          onNavigate={vi.fn()}
        />
      </>,
    );
    const input = screen.getByRole("textbox", {
      name: "Draft",
    }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 5, "backward");
    act(() => threadWorkflowActions.request("owner", action));
    await waitFor(() =>
      expect(copied).toContain(
        action === "copyMarkdown" ? "exact 中文 source" : "thread=owner",
      ),
    );
    expect(exec).toHaveBeenCalledExactlyOnceWith("copy");
    expect(document.activeElement).toBe(input);
    expect([
      input.selectionStart,
      input.selectionEnd,
      input.selectionDirection,
    ]).toEqual([1, 5, "backward"]);
    expect(input.value).toBe("keep draft");
  },
);

it("copies the retained edit buffer on HTTP without altering or resending it", async () => {
  let copied = "";
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => {
      copied = document.querySelector("textarea")!.value;
      return true;
    },
  });
  const source = {
    threadId: "owner",
    turnId: "turn",
    itemId: "user",
    rowId: "row",
  };
  useThreadWorkflowStore
    .getState()
    .setInlineEdit(source, "retained full 中文 edit\n");
  render(<ThreadEditRecovery threadId="owner" rows={[]} />);
  fireEvent.click(screen.getByText("未完成的消息编辑已保留"));
  fireEvent.click(screen.getByRole("button", { name: "复制保留的编辑内容" }));
  await waitFor(() => expect(copied).toBe("retained full 中文 edit\n"));
  expect(
    Object.values(useThreadWorkflowStore.getState().inlineEdits).map(
      (value) => value.text,
    ),
  ).toEqual(["retained full 中文 edit\n"]);
  expect(useThreadWorkflowStore.getState().mutations).toEqual({});
});
