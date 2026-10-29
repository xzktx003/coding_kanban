import {
  create,
  type StateCreator,
  type StoreApi,
  type UseBoundStore,
} from "zustand";
import { createEventsSlice } from "./eventsSlice";
import { createQueueSlice } from "./queueSlice";
import { createThreadsSlice } from "./threadsSlice";
import type { CodexStore } from "./types";

export type { CodexStore, TurnTiming } from "./types";

const createState: StateCreator<CodexStore> = (...a) => ({
  ...createThreadsSlice(...a),
  ...createEventsSlice(...a),
  ...createQueueSlice(...a),
});

type ModuleData = { codexStore?: UseBoundStore<StoreApi<CodexStore>> };
export function createCodexStoreForModule(
  data?: ModuleData,
  initializer: StateCreator<CodexStore> = createState,
) {
  const store = data?.codexStore;
  if (!store) {
    const created = create<CodexStore>()(initializer);
    // Dependency HMR can reevaluate this module via a React accept boundary
    // without calling this module's dispose. Register ownership immediately.
    if (data) data.codexStore = created;
    return created;
  }
  // Keep the live data and subscriptions, but refresh actions so fixes in a
  // replaced slice are used. Do not retain a state snapshot in module scope:
  // old ESM namespaces can survive and would pin that snapshot's whole body.
  const defaults = initializer(store.setState, store.getState, store);
  store.setState((current) => {
    const changed: Partial<CodexStore> = {};
    for (const key of Object.keys(defaults) as Array<keyof CodexStore>) {
      if (typeof defaults[key] === "function" || !(key in current))
        Object.assign(changed, { [key]: defaults[key] });
    }
    return Object.keys(changed).length ? changed : current;
  });
  return store;
}
export const useCodexStore = createCodexStoreForModule(import.meta.hot?.data);

export const useCurrentThread = () =>
  useCodexStore((state) => state.getCurrentThread());
