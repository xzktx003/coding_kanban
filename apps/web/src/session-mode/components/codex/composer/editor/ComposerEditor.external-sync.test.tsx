import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  $createParagraphNode,
  $createNodeSelection,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
} from "lexical";
import type { MentionItem } from "../mentions";
import { createRef } from "react";
import { ComposerEditor, type ComposerEditorHandle } from "./ComposerEditor";
import { usePluginInputDrafts } from "@session/features/plugins/pluginInputs";
import { $createMentionChipNode } from "./MentionChipNode";

const observed = vi.hoisted(() => ({
  editor: null as LexicalEditor | null,
  items: [] as MentionItem[],
}));
vi.mock("@lexical/react/LexicalComposerContext", async (load) => {
  const original =
    await load<typeof import("@lexical/react/LexicalComposerContext")>();
  return {
    ...original,
    useLexicalComposerContext: () => {
      const result = original.useLexicalComposerContext();
      observed.editor = result[0];
      return result;
    },
  };
});
vi.mock("../mentions", () => ({
  useMentionItems: () => ({ items: observed.items }),
}));
vi.mock("./MentionTypeaheadPlugin", () => ({
  MentionTypeaheadPlugin: () => null,
}));
vi.mock("../composerFocus", () => ({ shouldAutoFocusComposer: () => false }));

beforeEach(() => {
  if (!Range.prototype.getBoundingClientRect)
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  if (!Range.prototype.getClientRects)
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  observed.editor = null;
  observed.items = [];
  usePluginInputDrafts.setState({ drafts: {} });
});
const content = () =>
  observed.editor!.getEditorState().read(() => $getRoot().getTextContent());
async function typeText(text: string) {
  await act(async () =>
    observed.editor!.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        if (text) paragraph.append($createTextNode(text));
        root.append(paragraph);
      },
      { discrete: true },
    ),
  );
}
const props = {
  owner: "codex:original",
  value: "保留原会话草稿",
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  placeholder: "Original placeholder",
};

it("a non-text render cannot restore the stale controlled value between clear and fast typing", async () => {
  const onChange = vi.fn();
  const view = render(<ComposerEditor {...props} onChange={onChange} />);
  await waitFor(() => expect(content()).toBe(props.value));
  await typeText("");
  expect(onChange).toHaveBeenLastCalledWith("");
  view.rerender(
    <ComposerEditor
      {...props}
      onChange={onChange}
      placeholder="New non-text label"
    />,
  );
  await act(async () => {});
  expect(content()).toBe("");
  await act(async () =>
    observed.editor!.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph))
          throw Error("missing composer paragraph");
        paragraph.append($createTextNode("$fixture"));
      },
      { discrete: true },
    ),
  );
  expect(content()).toBe("$fixture");
});

it("late capability and captured-plugin updates preserve an unacknowledged user edit", async () => {
  const view = render(<ComposerEditor {...props} />);
  await waitFor(() => expect(content()).toBe(props.value));
  await typeText("$fixture");
  await act(async () =>
    usePluginInputDrafts.setState({
      drafts: {
        [props.owner]: [
          { name: "Fixture Plugin", path: "plugin://fixture@market" },
        ],
      },
    }),
  );
  view.rerender(<ComposerEditor {...props} />);
  await act(async () => {});
  expect(content()).toBe("$fixture");
});

it("deliberate external text changes still restore the captured plugin as a chip without autofocus", async () => {
  const view = render(<ComposerEditor {...props} />);
  await waitFor(() => expect(content()).toBe(props.value));
  await act(async () =>
    usePluginInputDrafts.setState({
      drafts: {
        [props.owner]: [
          { name: "Fixture Plugin", path: "plugin://fixture@market" },
        ],
      },
    }),
  );
  view.rerender(<ComposerEditor {...props} value="@Fixture Plugin" />);
  await waitFor(() => expect(content()).toBe("@Fixture Plugin"));
  expect(
    observed.editor!.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      return $isElementNode(paragraph)
        ? paragraph.getFirstChild()!.getType()
        : null;
    }),
  ).toBe("mention-chip");
  expect(document.activeElement?.getAttribute("contenteditable")).not.toBe(
    "true",
  );
});

it("restoring context after a passive draft replacement uses the current tree rather than a deleted caret node", async () => {
  const ref = createRef<ComposerEditorHandle>();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const view = render(
    <div>
      <button>Outside</button>
      <ComposerEditor {...props} ref={ref} />
    </div>,
  );
  await waitFor(() => expect(content()).toBe(props.value));
  await act(async () =>
    observed.editor!.update(() => $getRoot().selectEnd(), { discrete: true }),
  );
  view.getByRole("button", { name: "Outside" }).focus();
  view.rerender(
    <div>
      <button>Outside</button>
      <ComposerEditor {...props} ref={ref} value="Replacement captured draft" />
    </div>,
  );
  await waitFor(() => expect(content()).toBe("Replacement captured draft"));
  await act(async () => ref.current!.insertText(" restored context"));
  expect(content()).toBe("Replacement captured draft restored context");
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

it("keeps a valid saved caret when focus moves to a context attachment", async () => {
  const ref = createRef<ComposerEditorHandle>();
  const view = render(
    <div>
      <button>Attachment</button>
      <ComposerEditor {...props} value="alpha beta" ref={ref} />
    </div>,
  );
  await waitFor(() => expect(content()).toBe("alpha beta"));
  await act(async () =>
    observed.editor!.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw Error("missing paragraph");
        const text = paragraph.getFirstChild();
        if (!text || !("select" in text)) throw Error("missing text caret");
        (text as ReturnType<typeof $createTextNode>).select(5, 5);
      },
      { discrete: true },
    ),
  );
  view.getByRole("button", { name: "Attachment" }).focus();
  await act(async () => ref.current!.insertText(" inserted"));
  expect(content()).toBe("alpha inserted beta");
});

it("deletes a freshly selected DOM range before the delayed native selectionchange reaches Lexical", async () => {
  render(<ComposerEditor {...props} value="alpha beta" />);
  await waitFor(() => expect(content()).toBe("alpha beta"));
  await act(async () =>
    observed.editor!.update(() => $getRoot().selectEnd(), { discrete: true }),
  );
  const root = observed.editor!.getRootElement()!;
  root.focus();
  act(() => {
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    // Native selectionchange is asynchronous; Delete can arrive first.
    fireEvent.keyDown(root, {
      key: "Delete",
      code: "Delete",
      keyCode: 46,
      which: 46,
    });
  });
  await act(async () => {});
  expect(content()).toBe("");
});

it("deletes only a fresh partial DOM range rather than clearing the entire draft", async () => {
  render(<ComposerEditor {...props} value="alpha beta" />);
  await waitFor(() => expect(content()).toBe("alpha beta"));
  await act(async () =>
    observed.editor!.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw Error("missing paragraph");
        (
          paragraph.getFirstChild() as ReturnType<typeof $createTextNode>
        ).select(2, 4);
      },
      { discrete: true },
    ),
  );
  const root = observed.editor!.getRootElement()!;
  root.focus();
  act(() => {
    const range = document.createRange(),
      text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode()!;
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.keyDown(root, {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      which: 8,
    });
  });
  await act(async () => {});
  expect(content()).toBe(" beta");
});

it.each([
  { isComposing: true, keyCode: 46 },
  { isComposing: false, keyCode: 229 },
  { isComposing: false, keyCode: 46, editorComposing: true },
])(
  "leaves composition deletion under native IME ownership ($isComposing/$keyCode)",
  async (keyboard) => {
    render(<ComposerEditor {...props} value="alpha beta" />);
    await waitFor(() => expect(content()).toBe("alpha beta"));
    await act(async () =>
      observed.editor!.update(() => $getRoot().selectEnd(), { discrete: true }),
    );
    const root = observed.editor!.getRootElement()!;
    root.focus();
    const composing = keyboard.editorComposing
      ? vi.spyOn(observed.editor!, "isComposing").mockReturnValue(true)
      : undefined;
    act(() => {
      const range = document.createRange();
      range.selectNodeContents(root);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.keyDown(root, { key: "Delete", code: "Delete", ...keyboard });
    });
    await act(async () => {});
    expect(content()).toBe("alpha beta");
    composing?.mockRestore();
  },
);

it("keeps atomic chip node deletion when Lexical owns a node selection", async () => {
  render(<ComposerEditor {...props} value="alpha beta" />);
  await waitFor(() => expect(content()).toBe("alpha beta"));
  await act(async () =>
    observed.editor!.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw Error("missing paragraph");
        const chip = $createMentionChipNode({
          insertText: "@Fixture Plugin",
          displayName: "Fixture Plugin",
          iconSrc: null,
          brandColor: null,
        });
        paragraph.append(chip);
        const selected = $createNodeSelection();
        selected.add(chip.getKey());
        $setSelection(selected);
      },
      { discrete: true, tag: SKIP_DOM_SELECTION_TAG },
    ),
  );
  const root = observed.editor!.getRootElement()!;
  act(() => {
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.keyDown(root, {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
    });
  });
  await act(async () => {});
  expect(content()).toBe("alpha beta");
});
