import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TurnFailureNotice } from "./TurnFailureNotice";

it("uses the original error message and native circle glyph without inventing a failure title", () => {
  const { container } = render(
    <TurnFailureNotice
      message={JSON.stringify({
        error: { message: "The model cannot complete this request." },
      })}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "The model cannot complete this request.",
  );
  expect(
    container
      .querySelector(".codex-native-error-card svg")
      ?.getAttribute("viewBox"),
  ).toBe("0 0 16 16");
});

it("makes valid bare HTTP URLs explicit external links and preserves other error syntax as text", () => {
  const value =
    "See https://example.invalid/help. Keep `https://example.invalid/code` and [guide](https://example.invalid/markdown), <https://example.invalid/tag>, javascript:alert(1), **details**.";
  render(<TurnFailureNotice message={value} />);
  const link = screen.getByRole("link", {
    name: "https://example.invalid/help",
  });
  expect(link.getAttribute("href")).toBe("https://example.invalid/help");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("alert").textContent).toBe(value);
});

it("keeps the native oversized argument error visible and the local recovery explanation collapsed", () => {
  const message =
    "Invalid 'input[2].arguments': string too long. Expected maximum length 1048576.";
  const { container } = render(<TurnFailureNotice message={message} />);
  expect(screen.getByText(message, { exact: true })).toBeTruthy();
  const details = container.querySelector("details");
  expect(details?.open).toBe(false);
  expect(details?.textContent).toContain("历史工具调用参数过长");
  expect(screen.queryByRole("button", { name: /重试|Retry/ })).toBeNull();
});

it("renders retry progress as a status and only expands actual additional details on explicit click", () => {
  const { container } = render(
    <TurnFailureNotice
      message="Reconnecting... 2/5"
      willRetry
      additionalDetails="Temporary upstream failure"
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("Reconnecting 2/5");
  expect(screen.queryByRole("alert")).toBeNull();
  const expand = screen.getByRole("button", { name: "Reconnecting 2/5" });
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain("Temporary upstream failure");
  fireEvent.click(expand);
  expect(expand.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Temporary upstream failure");
});
