import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ComposerMenu } from "./ComposerMenu";
import { ConversationMenu } from "./ConversationMenu";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useCodexStore } from "../stores/useCodexStore";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";
vi.mock("./mentions", () => ({
  useMentionItems: () => ({ items: [] }),
  mentionsWithIcon: (items: unknown[]) => items,
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    webSearchRequest: false,
    setWebSearch: vi.fn(),
    modelProvider: "openai",
    model: "fixture",
    reasoningEffort: "medium",
  }),
}));
beforeEach(() => {
  useLayoutStore.setState({ view: "agent" });
  useCodexStore.setState({ currentThreadId: "owner" });
  useSessionDraftStore.setState({
    drafts: { owner: { text: "Main draft retained", revision: 1 } },
  });
});
function mount() {
  const selected = vi.fn();
  const view = render(
    <div className="session-mode">
      <ComposerMenu
        owner="owner"
        actions={(_close, trigger) => <>{trigger}</>}
        persistentMenu={({ triggerContainer, close, parentMenuId }) => (
          <ConversationMenu
            threadId="owner"
            title="fixture"
            variant="item"
            triggerContainer={triggerContainer}
            parentMenuId={parentMenuId}
            onActionSelected={() => {
              selected();
              close();
            }}
          />
        )}
      />
    </div>,
  );
  return { ...view, selected, attach: screen.getByRole("button", { name: "附加文件" }) };
}
async function choose(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  fireEvent.keyDown(
    await screen.findByRole("button", { name: "当前会话的更多操作" }),
    { key: "ArrowDown" },
  );
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}
it("keeps the confirmation owner mounted after a selected action closes its parent", async () => {
  const view = mount();
  await choose("归档聊天");
  const dialog = await screen.findByRole("dialog", { name: "归档聊天" });
  await waitFor(() =>
    expect(
      view.attach.getAttribute("aria-expanded"),
    ).toBe("false"),
  );
  expect(dialog.isConnected).toBe(true);
  expect(view.selected).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "返回" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("retains a local note buffer across parent closing and explicit cancel/reopen without changing the main draft", async () => {
  mount();
  await choose("会议：记笔记");
  const field = await screen.findByRole("textbox", { name: "会议笔记" });
  fireEvent.change(field, { target: { value: "Local dialog buffer" } });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await choose("会议：记笔记");
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "会议笔记",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe("Local dialog buffer");
  expect(useSessionDraftStore.getState().drafts.owner.text).toBe(
    "Main draft retained",
  );
});
it("does not complete an action for a disabled item or for Escape", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  const trigger = await screen.findByRole("button", {
    name: "当前会话的更多操作",
  });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const item = await screen.findByRole("menuitem", { name: "重命名聊天" });
  fireEvent.click(item);
  expect(view.selected).not.toHaveBeenCalled();
  fireEvent.keyDown(item, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(view.selected).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: "附加文件" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
});
