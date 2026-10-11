import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NativeSubmitButton } from "./NativeSubmitButton";
import { NativeComposerIcon } from "./NativeComposerIcon";

afterEach(cleanup);

it("shows the native busy state without losing the action label or queued width", () => {
  const { rerender } = render(
    <NativeSubmitButton aria-label="排队消息" loading>
      <span>排队</span>
    </NativeSubmitButton>,
  );
  const button = screen.getByRole("button", { name: "排队消息" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(
    button.querySelector('[data-native-icon="spinner-native-16"]'),
  ).not.toBeNull();
  expect(
    button
      .querySelector(".session-native-submit-content")
      ?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(button.textContent).toContain("排队");
  rerender(
    <NativeSubmitButton aria-label="排队消息">
      <span>排队</span>
    </NativeSubmitButton>,
  );
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(
    button.querySelector('[data-native-icon="spinner-native-16"]'),
  ).toBeNull();
});

it("keeps an ordinary disabled action distinct from a pending stop", () => {
  render(
    <NativeSubmitButton aria-label="停止" disabled>
      <NativeComposerIcon name="stop" />
    </NativeSubmitButton>,
  );
  const button = screen.getByRole("button", { name: "停止" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(
    button.querySelector('[data-native-icon="spinner-native-16"]'),
  ).toBeNull();
});
