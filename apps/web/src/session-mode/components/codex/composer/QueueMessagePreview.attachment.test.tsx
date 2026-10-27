import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { QueueMessagePreview } from "./QueueMessagePreview";
it("renders a non-draggable attachment thumbnail without turning it into an action", () => {
  const view = render(
    <QueueMessagePreview
      text=""
      summary="3 张图像"
      position={1}
      threadId="owner"
      imagePath="/fixture/first.png"
    />,
  );
  const image = screen.getByRole("img", { name: "图像附件" });
  expect(image.getAttribute("src")).toContain("path=%2Ffixture%2Ffirst.png");
  expect(image.getAttribute("draggable")).toBe("false");
  expect(image.closest("button,a,[role=button]")).toBeNull();
  fireEvent.click(image);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(
    <QueueMessagePreview text="next" position={1} threadId="other" />,
  );
  expect(screen.queryByRole("img")).toBeNull();
});
