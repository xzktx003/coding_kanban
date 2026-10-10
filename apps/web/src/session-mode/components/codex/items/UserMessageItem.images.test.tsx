import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { UserMessageItem } from "./UserMessageItem";
it("opens a user attachment at its original size and keeps a download action", () => {
  const src = "data:image/png;base64,AA==";
  render(
    <div className="session-mode">
      <UserMessageItem content={[{ type: "image", url: src } as never]} />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "放大Uploaded 1" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(
    screen.getByRole("img", { name: "Uploaded 1大图" }).getAttribute("src"),
  ).toBe(src);
  expect(
    screen.getByRole("link", { name: "下载图片" }).getAttribute("href"),
  ).toBe(src);
});
