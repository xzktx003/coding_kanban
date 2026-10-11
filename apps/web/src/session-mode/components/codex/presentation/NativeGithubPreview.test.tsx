import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import {
  NativeGithubPreview,
  NativeGithubPreviewHost,
  type NativeGithubPreviewTransport,
} from "./NativeGithubPreview";
const href = "https://github.com/OpenAI/Codex/pull/42/files";
const info = {
  base: "main",
  head: "fix",
  draft: false,
  merged: false,
  number: 42,
  state: "OPEN",
  title: "Fix routing",
};
it("changes locale on an open cached card without closing or rereading it", async () => {
  vi.useFakeTimers();
  const locale = createInstance();
  await locale.init({
    lng: "zh",
    resources: {
      zh: { translation: {} },
      en: { translation: {} },
      ja: { translation: {} },
    },
  });
  const read = vi.fn(async () => ({ structuredContent: info }));
  render(
    <I18nextProvider i18n={locale}>
      <NativeGithubPreviewHost.Provider
        value={{
          enabled: true,
          transport: { identity: () => "account", read },
        }}
      >
        <NativeGithubPreview href={href}>
          <a href={href}>Review</a>
        </NativeGithubPreview>
      </NativeGithubPreviewHost.Provider>
    </I18nextProvider>,
  );
  fireEvent.focus(screen.getByText("Review"));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("OpenAI/Codex · #42 · 已打开")).toBeTruthy();
  await act(async () => {
    await locale.changeLanguage("en");
  });
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(screen.getByText("OpenAI/Codex · #42 · Open")).toBeTruthy();
  await act(async () => {
    await locale.changeLanguage("ja");
  });
  expect(screen.getByText("OpenAI/Codex · #42 · オープン")).toBeTruthy();
  expect(screen.getByRole("link", { name: "ウェブサイトを開く" })).toBeTruthy();
  expect(read).toHaveBeenCalledOnce();
});
afterEach(() => vi.useRealTimers());
const show = (
  enabled: boolean,
  transport: NativeGithubPreviewTransport | null,
) =>
  render(
    <NativeGithubPreviewHost.Provider value={{ enabled, transport }}>
      <NativeGithubPreview href={href}>
        <a href={href}>Review</a>
      </NativeGithubPreview>
    </NativeGithubPreviewHost.Provider>,
  );
it("does not read or render the rich card when the native feature gate is off", async () => {
  vi.useFakeTimers();
  const read = vi.fn();
  show(false, { identity: () => "account", read });
  fireEvent.focus(screen.getByText("Review"));
  await act(() => vi.advanceTimersByTimeAsync(800));
  expect(screen.queryByText("OpenAI/Codex · #42")).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(screen.getByRole("tooltip").textContent).toBe(href);
});
it("retains repository and number without inventing status when unavailable", async () => {
  vi.useFakeTimers();
  show(true, null);
  fireEvent.focus(screen.getByText("Review"));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("OpenAI/Codex · #42")).toBeTruthy();
  expect(screen.queryByText(/已打开/)).toBeNull();
});
it.each([
  [{}, "已打开"],
  [{ draft: true }, "草稿"],
  [{ state: "closed" }, "已关闭"],
  [{ merged: true }, "已合并"],
])(
  "renders actual PR lifecycle %j and keyboard Open link",
  async (fields, label) => {
    vi.useFakeTimers();
    show(true, {
      identity: () => "account",
      read: async () => ({ structuredContent: { ...info, ...fields } }),
    });
    const trigger = screen.getByText("Review");
    fireEvent.focus(trigger);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText(`OpenAI/Codex · #42 · ${label}`)).toBeTruthy();
    expect(screen.getByText("Fix routing")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "打开网站" }),
    );
    expect(document.activeElement?.getAttribute("href")).toBe(href);
  },
);
it("discards the old account result after a connection identity changes", async () => {
  vi.useFakeTimers();
  let identity = "a",
    finish!: (v: unknown) => void;
  show(true, {
    identity: () => identity,
    read: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  fireEvent.focus(screen.getByText("Review"));
  await act(() => vi.advanceTimersByTimeAsync(0));
  identity = "b";
  await act(async () => finish({ structuredContent: info }));
  expect(screen.queryByText("Fix routing")).toBeNull();
  expect(screen.getByText("OpenAI/Codex · #42")).toBeTruthy();
});

it("a disabled PR experiment still uses the native ordinary website host, without a GitHub MCP read", async () => {
  vi.useFakeTimers();
  const githubRead = vi.fn(),
    websiteRead = vi.fn(async () => ({
      status: "ready",
      title: "Public website metadata",
      description: null,
      image: null,
    }));
  const { NativeWebsitePreviewHost } = await import("./NativeWebsitePreview");
  render(
    <NativeWebsitePreviewHost.Provider
      value={{ identity: () => "website", read: websiteRead }}
    >
      <NativeGithubPreviewHost.Provider
        value={{
          enabled: false,
          transport: { identity: () => "github", read: githubRead },
        }}
      >
        <NativeGithubPreview href={href}>
          <a href={href}>Public PR</a>
        </NativeGithubPreview>
      </NativeGithubPreviewHost.Provider>
    </NativeWebsitePreviewHost.Provider>,
  );
  fireEvent.focus(screen.getByText("Public PR"));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("Public website metadata")).toBeTruthy();
  expect(websiteRead).toHaveBeenCalledOnce();
  expect(githubRead).not.toHaveBeenCalled();
});
