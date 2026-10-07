import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Toolbar } from "./SessionManagerShared";
it("clearing session search restores focus without changing selection", () => {
  const search = vi.fn(),
    toggle = vi.fn();
  render(
    <Toolbar
      search="中文"
      onSearch={search}
      selectedCount={1}
      allSelected={false}
      onToggleAll={toggle}
      onDeleteSelected={() => {}}
    />,
  );
  const input = screen.getByRole("textbox", { name: "搜索会话" });
  fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
  expect(search).toHaveBeenCalledWith("");
  expect(document.activeElement).toBe(input);
  expect(toggle).not.toHaveBeenCalled();
});
