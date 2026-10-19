import { createJSONStorage } from "zustand/middleware";

/** Equal snapshots need no synchronous write, including Zustand no-op sets. */
export function createDeduplicatedJSONStorage<T>() {
  return createJSONStorage<T>(() => ({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      // Read the shared value each time: another page can change or clear it.
      // A page-local last-written cache would incorrectly skip the next save.
      if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
    },
    removeItem: (key) => localStorage.removeItem(key),
  }));
}
