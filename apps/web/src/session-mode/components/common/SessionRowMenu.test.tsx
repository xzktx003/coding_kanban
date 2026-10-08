import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const rename = vi.hoisted(() => vi.fn());
vi.mock("../../services/sessionNames", () => ({ renameSession: rename }));
import { SessionRowMenu } from "./SessionRowMenu";
it("menu rename stays mounted after menu closes and failures can retry without selecting the row", async () => {
  const select = vi.fn();
  rename
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  render(
    <div onClick={select}>
      <SessionRowMenu rename={{ kind: "cc", id: "a", title: "旧名称" }}>
        {null}
      </SessionRowMenu>
    </div>,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "会话操作" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "重命名" }));
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "新名称" } });
  fireEvent.submit(input.closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toContain("offline");
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(rename).toHaveBeenLastCalledWith("cc", "a", "新名称");
  expect(select).not.toHaveBeenCalled();
});
