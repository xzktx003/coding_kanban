import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { toast } from "sonner";
import { Toaster } from "@session/components/ui/toaster";
import { ThemeProvider, useThemeContext } from "@session/contexts/ThemeContext";
import { useThemeStore, type Theme } from "@session/stores/settings/useThemeStore";
import { SessionThemeToggle } from "@session/components/common/SessionThemeToggle";
import { NativeNotificationViewport } from "@session/features/native-notifications/NativeNotificationViewport";
import { nativeNotifications } from "@session/features/native-notifications/service";

const MESSAGE = "推理强度已设为高";
const NATIVE_MESSAGE = "R23 独立原生通知";
const DRAFT = "R23 保留输入草稿";
const i18n = createInstance();

// jsdom lacks a real MediaQueryList constructor. This controls only the browser
// media signal; ThemeProvider, useThemeContext, the store and Sonner stay real.
class DarkMedia extends EventTarget {
  readonly media = "(prefers-color-scheme: dark)";
  matches = true;
  onchange: ((event: MediaQueryListEvent) => void) | null = null;
  addListener(listener: EventListener) { this.addEventListener("change", listener); }
  removeListener(listener: EventListener) { this.removeEventListener("change", listener); }
  setDark(matches: boolean) {
    if (this.matches === matches) return;
    this.matches = matches;
    const event = new Event("change");
    Object.defineProperties(event, {
      matches: { value: matches },
      media: { value: this.media },
    });
    this.dispatchEvent(event);
    this.onchange?.(event as MediaQueryListEvent);
  }
}

let root: HTMLElement;
let media: DarkMedia;
let previousTheme: Pick<ReturnType<typeof useThemeStore.getState>, "theme" | "accent" | "starfield" | "backgroundImage">;
let unexpectedFetch: ReturnType<typeof vi.fn>;
const defaultDismiss = vi.fn();
const nativeRemove = vi.fn();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "zh",
    fallbackLng: false,
    resources: { zh: { translation: {} } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

beforeEach(() => {
  defaultDismiss.mockClear();
  nativeRemove.mockClear();
  const current = useThemeStore.getState();
  previousTheme = {
    theme: current.theme, accent: current.accent,
    starfield: current.starfield, backgroundImage: current.backgroundImage,
  };
  media = new DarkMedia();
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    if (query !== media.media) throw new Error(`Unexpected R23 media query: ${query}`);
    return media as unknown as MediaQueryList;
  }));
  unexpectedFetch = vi.fn().mockRejectedValue(new Error("Unexpected R23 network request"));
  vi.stubGlobal("fetch", unexpectedFetch);
  root = document.createElement("div");
  root.className = "session-mode dark";
  document.body.append(root);
});

afterEach(async () => {
  try {
    act(() => {
      nativeNotifications.closeAll();
      for (const entry of toast.getToasts()) toast.dismiss(entry.id);
    });
    await waitFor(() => expect(document.querySelector("[data-sonner-toast]")).toBeNull(), { timeout: 2_000 });
    expect(unexpectedFetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
    root.remove();
    useThemeStore.setState(previousTheme);
    vi.unstubAllGlobals();
  }
});

function ThemeWitness() {
  const { theme, resolvedTheme } = useThemeContext();
  return <output data-testid="resolved-theme" data-theme={theme} data-resolved-theme={resolvedTheme} />;
}

function mount(theme: Theme, darkMedia = true) {
  media.setDark(darkMedia);
  useThemeStore.setState({ theme, accent: "default", starfield: false, backgroundImage: null });
  return render(
    <ThemeProvider>
      <ThemeProvider>
        <I18nextProvider i18n={i18n}>
          <ThemeWitness />
          <input aria-label="R23 草稿" defaultValue={DRAFT} />
          <SessionThemeToggle />
          <button type="button" onClick={() => toast.message(MESSAGE, { duration: Infinity, onDismiss: defaultDismiss })}>发普通提示</button>
          <button type="button" onClick={() => nativeNotifications.info(NATIVE_MESSAGE, { duration: 0, onRemove: nativeRemove })}>发具名通知</button>
          <Toaster />
          <NativeNotificationViewport />
        </I18nextProvider>
      </ThemeProvider>
    </ThemeProvider>,
    { container: root },
  );
}

async function ordinary() {
  fireEvent.click(screen.getByRole("button", { name: "发普通提示" }));
  const title = await screen.findByText(MESSAGE, { exact: true });
  const item = title.closest<HTMLElement>("[data-sonner-toast]");
  const toaster = item?.closest<HTMLOListElement>("[data-sonner-toaster]");
  expect(item).not.toBeNull();
  expect(toaster).not.toBeNull();
  if (!item || !toaster) throw new Error("Real ordinary Sonner DOM not mounted");
  expect(toaster.classList.contains("codex-native-sonner-toaster")).toBe(false);
  expect(toaster.dataset.yPosition).toBe("top");
  expect(toaster.dataset.xPosition).toBe("right");
  expect(toaster.style.getPropertyValue("--offset-top")).toBe("20px");
  expect(toaster.style.getPropertyValue("--offset-right")).toBe("20px");
  expect(item.getAttribute("data-styled")).toBe("true");
  expect(item.getAttribute("data-rich-colors")).toBe("true");
  expect(item.classList.contains("overflow-visible!")).toBe(true);
  expect(within(item).getByRole("button", { name: "Close toast" })).toBeTruthy();
  expect(screen.getAllByText(MESSAGE, { exact: true })).toHaveLength(1);
  return { item, toaster };
}

async function resolved(theme: "light" | "dark", selected: Theme) {
  await waitFor(() => {
    expect(screen.getByTestId("resolved-theme").getAttribute("data-theme")).toBe(selected);
    expect(screen.getByTestId("resolved-theme").getAttribute("data-resolved-theme")).toBe(theme);
    expect(root.classList.contains(theme)).toBe(true);
    expect(root.style.colorScheme).toBe(theme);
  });
}

it("follows real dark→light toggling without remounting the ordinary message or changing its position/close flow", async () => {
  mount("dark");
  await resolved("dark", "dark");
  const draft = screen.getByRole("textbox", { name: "R23 草稿" });
  const { item, toaster } = await ordinary();
  // Expected product RED on the frozen wrapper: actual Sonner theme is light.
  expect.soft(toaster.getAttribute("data-sonner-theme")).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "切换为浅色模式" }));
  await resolved("light", "light");
  await waitFor(() => expect(toaster.getAttribute("data-sonner-theme")).toBe("light"));
  expect(screen.getByRole("textbox", { name: "R23 草稿" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe(DRAFT);
  expect(screen.getByText(MESSAGE, { exact: true }).closest("[data-sonner-toast]")).toBe(item);
  expect(defaultDismiss).not.toHaveBeenCalled();
  expect(nativeRemove).not.toHaveBeenCalled();
  fireEvent.click(within(item).getByRole("button", { name: "Close toast" }));
  await waitFor(() => expect(screen.queryByText(MESSAGE, { exact: true })).toBeNull());
  expect(defaultDismiss).toHaveBeenCalledTimes(1);
});

it("uses the real system-resolved theme and updates an existing ordinary message for media changes", async () => {
  mount("system", true);
  await resolved("dark", "system");
  const { item, toaster } = await ordinary();
  expect.soft(toaster.getAttribute("data-sonner-theme")).toBe("dark");
  act(() => media.setDark(false));
  await resolved("light", "system");
  await waitFor(() => expect(toaster.getAttribute("data-sonner-theme")).toBe("light"));
  act(() => media.setDark(true));
  await resolved("dark", "system");
  expect.soft(toaster.getAttribute("data-sonner-theme")).toBe("dark");
  expect(useThemeStore.getState().theme).toBe("system");
  expect(screen.getByText(MESSAGE, { exact: true }).closest("[data-sonner-toast]")).toBe(item);
  expect(screen.getAllByText(MESSAGE, { exact: true })).toHaveLength(1);
  expect(defaultDismiss).not.toHaveBeenCalled();
});

it("keeps explicit light with dark media and separates default ordinary messages from the real codex-native channel", async () => {
  mount("light", true);
  await resolved("light", "light");
  const { item, toaster } = await ordinary();
  expect(toaster.getAttribute("data-sonner-theme")).toBe("light");
  fireEvent.click(screen.getByRole("button", { name: "发具名通知" }));
  const title = await screen.findByText(NATIVE_MESSAGE, { exact: true });
  const nativeItem = title.closest<HTMLElement>("[data-sonner-toast]");
  const named = title.closest<HTMLOListElement>(".codex-native-sonner-toaster");
  expect(nativeItem).not.toBeNull();
  expect(named).not.toBeNull();
  if (!nativeItem || !named) throw new Error("Real named Sonner DOM not mounted");
  expect(named).not.toBe(toaster);
  expect(named.dataset.yPosition).toBe("top");
  expect(named.dataset.xPosition).toBe("center");
  expect(nativeItem.getAttribute("data-styled")).toBe("false");
  expect(within(toaster).queryByText(NATIVE_MESSAGE, { exact: true })).toBeNull();
  expect(within(named).queryByText(MESSAGE, { exact: true })).toBeNull();
  expect(screen.getAllByText(NATIVE_MESSAGE, { exact: true })).toHaveLength(1);
  act(() => media.setDark(false));
  await resolved("light", "light");
  act(() => media.setDark(true));
  await resolved("light", "light");
  expect(toaster.getAttribute("data-sonner-theme")).toBe("light");
  fireEvent.click(within(item).getByRole("button", { name: "Close toast" }));
  await waitFor(() => expect(screen.queryByText(MESSAGE, { exact: true })).toBeNull());
  expect(screen.getByText(NATIVE_MESSAGE, { exact: true }).closest("[data-sonner-toast]")).toBe(nativeItem);
  expect(defaultDismiss).toHaveBeenCalledTimes(1);
  expect(nativeRemove).not.toHaveBeenCalled();
  fireEvent.click(within(nativeItem).getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(screen.queryByText(NATIVE_MESSAGE, { exact: true })).toBeNull());
  expect(nativeRemove).toHaveBeenCalledTimes(1);
  expect(defaultDismiss).toHaveBeenCalledTimes(1);
});
