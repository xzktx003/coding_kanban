import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CodexSystemRecords } from "./CodexSystemRecords";
import { EventItem } from "../items/EventItem";
it("hides the entry when no records are loaded", () => {
  const { container } = render(
    <CodexSystemRecords threadId="owner" count={0} />,
  );
  expect(container.childElementCount).toBe(0);
});
it("shows one compact entry and only exposes the protocol detail on demand", async () => {
  render(<CodexSystemRecords threadId="owner" count={2} />);
  expect(screen.queryByText("会话运行实例已关闭")).toBeNull();
  expect(screen.queryByText("thread/closed")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "系统记录，2条" }));
  expect(await screen.findByRole("dialog", { name: "系统记录" })).toBeTruthy();
  expect(screen.getAllByText("会话运行实例已关闭")).toHaveLength(1);
  expect(screen.getByText("× 2")).toBeTruthy();
  const details = screen.getByText("查看协议与会话 ID").closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "关闭系统记录" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("drops an open panel on an explicitly keyed thread switch", async () => {
  const { rerender } = render(
    <CodexSystemRecords key="owner" threadId="owner" count={2} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "系统记录，2条" }));
  await screen.findByRole("dialog");
  rerender(<CodexSystemRecords key="other" threadId="other" count={1} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "系统记录，1条" })).toBeTruthy();
});
it("does not render a thread closed protocol box through the generic event renderer", () => {
  const { container } = render(
    <EventItem
      event={{ method: "thread/closed", params: { threadId: "owner" } }}
    />,
  );
  expect(container.childElementCount).toBe(0);
});
it("does not reopen itself when an empty snapshot later receives new records", async () => {
  const { rerender } = render(
    <CodexSystemRecords threadId="owner" count={2} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "系统记录，2条" }));
  await screen.findByRole("dialog");
  rerender(<CodexSystemRecords threadId="owner" count={0} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<CodexSystemRecords threadId="owner" count={1} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "系统记录，1条" })).toBeTruthy();
});
