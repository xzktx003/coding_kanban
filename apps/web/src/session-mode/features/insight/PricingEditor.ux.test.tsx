import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PricingEditor } from "./PricingEditor";
test("pricing dialog supports named fields and Escape without saving", async () => {
  const close = vi.fn(),
    save = vi.fn();
  render(
    <PricingEditor
      pricing={{
        "fixture-model": {
          input: 15,
          output: 18.75,
          cache_read: 1.5,
          cache_creation: 2,
        },
      }}
      onClose={close}
      onSave={save}
    />,
  );
  const dialog = await screen.findByRole("dialog", { name: "模型计价" });
  expect(
    screen.getByRole("spinbutton", { name: "fixture-model 输入" }),
  ).toBeTruthy();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

test("reset displays the same pricing values that will be saved", async () => {
  const save = vi.fn();
  render(
    <PricingEditor
      pricing={{
        "gpt-5": { input: 99, output: 99, cache_read: 99, cache_creation: 99 },
      }}
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
  const input = screen.getByRole("spinbutton", {
    name: "gpt-5 输入",
  }) as HTMLInputElement;
  expect(Number(input.value)).toBe(2.5);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(save.mock.calls[0][0]["gpt-5"].input).toBe(Number(input.value));
});
