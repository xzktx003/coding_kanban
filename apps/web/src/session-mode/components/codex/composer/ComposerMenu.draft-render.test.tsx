import { fireEvent, render, screen } from "@testing-library/react";
import { useCallback } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ComposerMenu, type ComposerMenuProps } from "./ComposerMenu";
import { ConversationMenu } from "./ConversationMenu";
import { useCodexStore } from "../stores/useCodexStore";
import {
  sessionDraftKey,
  useSessionDraftStore,
  useSessionTextDraft,
} from "@session/stores/useSessionDraftStore";

const probes = vi.hoisted(() => ({ modelRenders: vi.fn(), items: vi.fn() }));
vi.mock("./mentions", () => ({
  useMentionItems: () => ({ items: [] }),
  mentionsWithIcon: (items: unknown[]) => items,
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: (threadId: string | null) => {
    probes.modelRenders(threadId);
    return {
      model: "fixture",
      modelProvider: "openai",
      reasoningEffort: "medium",
      collaborationMode: "default",
      webSearchRequest: false,
      setWebSearch: vi.fn(),
    };
  },
}));

function DraftComposer({
  threadId = "draft-menu-owner",
}: {
  threadId?: string;
}) {
  const owner = sessionDraftKey("codex", threadId);
  const { inputValue, setInputValue } = useSessionTextDraft(owner, "codex");
  const persistentMenu = useCallback<
    NonNullable<ComposerMenuProps["persistentMenu"]>
  >(
    ({ triggerContainer, close, parentMenuId }) => (
      <ConversationMenu
        threadId={threadId}
        draftOwner={owner}
        title="fixture"
        variant="item"
        triggerContainer={triggerContainer}
        onActionSelected={close}
        parentMenuId={parentMenuId}
      />
    ),
    [threadId, owner],
  );
  return (
    <div className="session-mode">
      <textarea
        aria-label="local draft"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
      />
      <ComposerMenu
        owner={owner}
        // These are deliberately fresh: ordinary parent input renders must not
        // construct the closed menu, and open menus must retain current props.
        onGoal={() => {}}
        actions={(_close, trigger) => {
          probes.items();
          return (
            <>
              <button type="button">Draft action: {inputValue}</button>
              {trigger}
            </>
          );
        }}
        persistentMenu={persistentMenu}
      />
    </div>
  );
}
function typeDraft(text = "ordinary draft typing") {
  const input = screen.getByRole("textbox", { name: "local draft" });
  for (let index = 1; index <= text.length; index++)
    fireEvent.change(input, { target: { value: text.slice(0, index) } });
}
beforeEach(() => {
  vi.clearAllMocks();
  useCodexStore.setState({ currentThreadId: null, threads: [], events: {} });
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
});

it("does not construct closed attach-menu items for ordinary per-character draft updates", () => {
  render(<DraftComposer />);
  probes.items.mockClear();
  typeDraft();
  expect(
    useSessionDraftStore.getState().drafts[
      sessionDraftKey("codex", "draft-menu-owner")
    ].text,
  ).toBe("ordinary draft typing");
  expect(probes.items).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: "附加文件" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("keeps the mounted conversation commands out of unrelated draft renders while respecting owner changes", () => {
  const view = render(<DraftComposer />);
  probes.modelRenders.mockClear();
  typeDraft();
  expect(
    probes.modelRenders.mock.calls.filter(([id]) => id === "draft-menu-owner"),
  ).toHaveLength(0);
  view.rerender(<DraftComposer threadId="next-draft-owner" />);
  expect(probes.modelRenders).toHaveBeenCalledWith("next-draft-owner");
});

it("retains an open menu and reads the latest draft props instead of freezing its actions", () => {
  render(<DraftComposer />);
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  expect(screen.getByRole("button", { name: "Draft action:" })).toBeTruthy();
  typeDraft("changed");
  expect(
    screen.getByRole("button", { name: "Draft action: changed" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "附加文件" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(probes.items).toHaveBeenCalled();
});
