import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UserMessageItem } from "./UserMessageItem";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
it("renders image syntax in user text as a native link while retaining following text", async () => {
  render(
    <UserMessageItem
      content={[
        {
          type: "text",
          text: "Before ![Preview](https://example.com/native-copy.png) after.",
          text_elements: [],
        },
      ]}
    />,
  );
  expect(
    (await screen.findByRole("link", { name: "Preview" })).getAttribute("href"),
  ).toBe("https://example.com/native-copy.png");
  expect(screen.queryByRole("img", { name: "Preview" })).toBeNull();
  expect(screen.getByText(/after\./)).toBeTruthy();
});
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
