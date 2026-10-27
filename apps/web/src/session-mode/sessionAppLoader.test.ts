import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preloading the application and composer does not initialize browser services", async () => {
  vi.resetModules();
  const observed = {
    window: [] as Array<{ type: string }>,
    document: [] as string[],
    channels: 0,
    localeSubscriptions: 0,
  };
  const addWindow = window.addEventListener.bind(window);
  const addDocument = document.addEventListener.bind(document);
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type, listener, options) => {
      observed.window.push({ type });
      addWindow(type, listener, options);
    },
  );
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type, listener, options) => {
      observed.document.push(type);
      addDocument(type, listener, options);
    },
  );
  const NativeChannel = globalThis.BroadcastChannel;
  vi.stubGlobal(
    "BroadcastChannel",
    class extends NativeChannel {
      constructor(name: string) {
        observed.channels += 1;
        super(name);
      }
    },
  );
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const locale = await import("./stores/settings/useLocaleStore");
  vi.spyOn(locale.useLocaleStore, "subscribe").mockImplementation((
    listener,
  ) => {
    observed.localeSubscriptions += 1;
    return vi.fn();
  });

  const { preloadSessionApp } = await import("./sessionWorkbenchLoader");
  await preloadSessionApp();
  const { i18n } = await import("./lib/i18n");

  expect(observed.window.filter(({ type }) => type !== "test")).toEqual([]);
  expect(observed.document).toEqual([]);
  expect(observed.channels).toBe(0);
  expect(observed.localeSubscriptions).toBe(0);
  expect(i18n.isInitialized ?? false).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
}, 30_000);
