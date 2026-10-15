export type CodexViewStorage = Pick<Storage, "getItem" | "setItem">;
const keys = [
  "kanban.codex.multiwindow.v2",
  "kanban.codex.multiwindow.v1",
  "kanban.codex.window-threads.v1",
  "kanban.codex.sidebar-width.v1",
  "kanban.codex.selected-project.v1",
];
const prefix = "kanban.codex.tab-view.v1:";

/** Per-tab snapshots; device storage supplies only a new tab's initial template. */
export function createCodexTabStorage(
  tabStorage?: CodexViewStorage,
  deviceStorage?: CodexViewStorage,
  profileId?: string,
): CodexViewStorage {
  if (
    profileId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      profileId,
    )
  )
    throw new Error("Invalid native client profile");
  const suffix = profileId ? `:${profileId}` : "";
  const values = new Map<string, string | null>();
  for (const key of keys) {
    let value: string | null = null;
    try {
      const saved = tabStorage?.getItem(prefix + key + suffix);
      if (saved !== null && saved !== undefined) {
        const parsed: unknown = JSON.parse(saved);
        if (typeof parsed === "string") value = parsed;
      } else value = deviceStorage?.getItem(key + suffix) ?? null;
    } catch {
      /* Storage is optional; this tab still keeps its own in-memory view. */
    }
    values.set(key, value);
    try {
      tabStorage?.setItem(prefix + key + suffix, JSON.stringify(value));
    } catch {
      /* Optional persistence. */
    }
  }
  const validate = (key: string) => {
    if (!values.has(key))
      throw new Error("Only Codex view metadata belongs in tab storage");
  };
  return {
    getItem(key) {
      validate(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      validate(key);
      values.set(key, value);
      try {
        tabStorage?.setItem(prefix + key + suffix, JSON.stringify(value));
      } catch {
        /* Optional persistence. */
      }
      try {
        deviceStorage?.setItem(key + suffix, value);
      } catch {
        /* Optional new-tab template. */
      }
    },
  };
}
