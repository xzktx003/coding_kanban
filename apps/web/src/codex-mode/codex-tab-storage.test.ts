import { expect, it } from "vitest";
import { createCodexTabStorage } from "./codex-tab-storage";
const layout = "kanban.codex.multiwindow.v2",
  threads = "kanban.codex.window-threads.v1";
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
it("keeps the same tab layout after another tab changes the device template", () => {
  const device = storage(),
    first = storage(),
    second = storage();
  device.setItem(layout, "initial");
  const a = createCodexTabStorage(first, device),
    b = createCodexTabStorage(second, device);
  a.setItem(layout, "A view");
  b.setItem(layout, "B view");
  expect(createCodexTabStorage(first, device).getItem(layout)).toBe("A view");
  expect(createCodexTabStorage(second, device).getItem(layout)).toBe("B view");
  expect(createCodexTabStorage(storage(), device).getItem(layout)).toBe(
    "B view",
  );
});
it("captures an absent startup thread mapping so another tab cannot supply its restore target later", () => {
  const device = storage(),
    first = storage(),
    second = storage();
  const a = createCodexTabStorage(first, device),
    b = createCodexTabStorage(second, device);
  b.setItem(threads, "B thread");
  expect(a.getItem(threads)).toBeNull();
  expect(createCodexTabStorage(first, device).getItem(threads)).toBeNull();
  expect(() => a.getItem("session-mode-draft")).toThrow(/Codex view/);
});
it("keeps profiles in the same browser tab from sharing startup mappings or device templates", () => {
  const tab = storage(),
    device = storage();
  const first = "019aabcd-1234-7890-abcd-000000000041",
    second = "019aabcd-1234-7890-abcd-000000000042";
  const a = createCodexTabStorage(tab, device, first);
  a.setItem(threads, "profile A startup mapping");
  const b = createCodexTabStorage(tab, device, second);
  expect(b.getItem(threads)).toBeNull();
  b.setItem(threads, "profile B startup mapping");
  expect(createCodexTabStorage(tab, device, first).getItem(threads)).toBe(
    "profile A startup mapping",
  );
  expect(
    createCodexTabStorage(storage(), device, second).getItem(threads),
  ).toBe("profile B startup mapping");
  expect(createCodexTabStorage(tab, device).getItem(threads)).toBeNull();
});
