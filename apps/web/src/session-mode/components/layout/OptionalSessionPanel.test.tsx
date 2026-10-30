import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OptionalSessionPanel } from "./OptionalSessionPanel";

it("isolates a failed optional module while the original input and draft remain usable", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const close = vi.fn();
  function Failed(): never {
    throw new Error("isolated optional module fetch failed");
  }
  try {
    render(
      <>
        <input aria-label="Draft" defaultValue="retained" />
        <OptionalSessionPanel label="工具" onClose={close}>
          <Failed />
        </OptionalSessionPanel>
      </>,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "retained and still editable" },
    });
    expect(input.value).toBe("retained and still editable");
    expect(screen.getByRole("alert").textContent).toContain("工具暂时无法加载");
    fireEvent.click(screen.getByRole("button", { name: "关闭此面板" }));
    expect(close).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});
