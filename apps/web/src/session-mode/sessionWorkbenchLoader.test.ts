import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preloading the session workbench does not start app listeners or requests", async () => {
  vi.resetModules();
  const observed = {
    window: [] as string[],
    document: [] as string[],
    channels: 0,
  };
  const addWindow = window.addEventListener.bind(window);
  const addDocument = document.addEventListener.bind(document);
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type, listener, options) => {
      observed.window.push(type);
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

  const { loadSessionWorkbench, preloadSessionWorkbench } =
    await import("./sessionWorkbenchLoader");
  preloadSessionWorkbench();
  await loadSessionWorkbench();

  expect(observed.window.filter((type) => type !== "test")).toEqual([]);
  expect(observed.document).toEqual([]);
  expect(observed.channels).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
}, 30_000);
