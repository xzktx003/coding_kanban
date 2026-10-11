import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  NativeWebsitePreview,
  NativeWebsitePreviewHost,
} from "./NativeWebsitePreview";
const href = "https://example.com/page#fragment";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it.each([
  [400, 200, "hero"],
  [100, 200, "thumbnail"],
  [100, 200, "standalone"],
])(
  "matches native image presentation %s/%s/%s",
  async (width, height, presentation) => {
    vi.useFakeTimers();
    const alone = presentation === "standalone";
    render(
      <NativeWebsitePreviewHost.Provider
        value={{
          identity: () => "host",
          read: async () => ({
            status: "ready",
            title: alone ? null : "Title",
            description: alone ? null : "Description",
            image: { dataUrl: png, width, height },
          }),
        }}
      >
        <NativeWebsitePreview href={href}>
          <a href={href}>Website</a>
        </NativeWebsitePreview>
      </NativeWebsitePreviewHost.Provider>,
    );
    fireEvent.focus(screen.getByText("Website"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const image = screen
      .getByRole("tooltip")
      .querySelector(".codex-native-slack-body img")!;
    expect(image.className).toContain(`codex-native-preview-${presentation}`);
    expect(image.getAttribute("src")).toBe("blob:preview-test");
    expect(image.getAttribute("draggable")).toBe("false");
    fireEvent.error(image);
    expect(
      screen
        .queryByRole("tooltip")
        ?.querySelector(".codex-native-slack-body img"),
    ).toBeNull();
    if (!alone) expect(screen.getByText("Title")).toBeTruthy();
  },
);
it("an unavailable host keeps the ordinary URL tooltip without reading", async () => {
  vi.useFakeTimers();
  render(
    <NativeWebsitePreviewHost.Provider value={null}>
      <NativeWebsitePreview href={href}>
        <a href={href}>Website</a>
      </NativeWebsitePreview>
    </NativeWebsitePreviewHost.Provider>,
  );
  fireEvent.focus(screen.getByText("Website"));
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(screen.getByRole("tooltip").textContent).toBe(href);
});
