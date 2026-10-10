import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { ThreadEditRecovery } from "./ThreadEditRecovery";
import { useThreadWorkflowStore } from "./delivery";
const source = {
  threadId: "owner",
  turnId: "original",
  itemId: "user",
  rowId: "row-original",
};
const original = {
  turnId: "original",
  itemId: "user",
  rowId: "row-original",
  role: "user" as const,
  text: "Original",
  completed: true,
};
beforeEach(() => {
  useThreadWorkflowStore.setState({ inlineEdits: {}, mutations: {} });
  useThreadWorkflowStore
    .getState()
    .setInlineEdit(source, "Preserved independent edit");
});
it("keeps a changed last-user edit reachable even when its old native row still exists", () => {
  render(
    <ThreadEditRecovery
      threadId="owner"
      rows={[
        original,
        { ...original, turnId: "newer", itemId: "new-user", rowId: "new-row" },
      ]}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Preserved independent edit",
  );
  expect(
    screen.getByRole("button", { name: "复制保留的编辑内容" }),
  ).toBeDefined();
});
it("matches exact turn/item identity and leaves the current inline editor or another owner's buffer alone", () => {
  const view = render(
    <ThreadEditRecovery threadId="owner" rows={[original]} />,
  );
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<ThreadEditRecovery threadId="other" rows={[]} />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(
    <ThreadEditRecovery
      threadId="owner"
      rows={[{ ...original, turnId: "different-turn" }]}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Preserved independent edit",
  );
});
