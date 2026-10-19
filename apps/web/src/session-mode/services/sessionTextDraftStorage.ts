import type { PersistStorage, StorageValue } from "zustand/middleware";

interface TextDraft {
  text: string;
  revision: number;
}
interface TextDraftState {
  drafts: Record<string, TextDraft>;
  migrated: string[];
}
const empty = (): TextDraftState => ({ drafts: {}, migrated: [] });

function readMarkers(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((kind) => typeof kind === "string"))
    throw new Error("Invalid draft migration markers");
  return value;
}

function readDraft(value: unknown): TextDraft | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as TextDraft).text !== "string" ||
    !Number.isSafeInteger((value as TextDraft).revision) ||
    (value as TextDraft).revision < 0
  )
    throw new Error("Invalid saved text draft");
  return value as TextDraft;
}

/** Synchronous per-owner saves keep reload safety without serializing every draft per keypress. */
export function createSessionTextDraftStorage(
  onError: () => void,
  onSaved: () => void = () => {},
): PersistStorage<TextDraftState> {
  let previous = empty();
  let readable = true;
  const prefix = (name: string) => `${name}.entry.`;
  const metadata = (name: string) => `${name}.meta`;
  return {
    getItem(name) {
      try {
        const raw = localStorage.getItem(name);
        const legacy = raw
          ? (JSON.parse(raw) as StorageValue<TextDraftState>)
          : null;
        // Keep the original v1 collection as a backup. New entries shadow it,
        // including null tombstones for sources removed by a draft move.
        if (
          legacy &&
          (!legacy.state ||
            !legacy.state.drafts ||
            typeof legacy.state.drafts !== "object" ||
            Array.isArray(legacy.state.drafts))
        )
          throw new Error("Invalid saved draft collection");
        const drafts = { ...legacy?.state.drafts };
        for (const draft of Object.values(drafts)) {
          if (readDraft(draft) === null)
            throw new Error("Invalid legacy draft");
        }
        const migrated = new Set(legacy?.state.migrated ?? []);
        const markers = localStorage.getItem(metadata(name));
        if (markers)
          for (const kind of readMarkers(markers)) migrated.add(kind);
        const entryPrefix = prefix(name);
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith(entryPrefix)) continue;
          const owner = decodeURIComponent(key.slice(entryPrefix.length));
          const entry = localStorage.getItem(key);
          if (entry === null) continue;
          const draft = readDraft(JSON.parse(entry));
          if (draft === null) delete drafts[owner];
          else
            Object.defineProperty(drafts, owner, {
              value: draft,
              enumerable: true,
              configurable: true,
              writable: true,
            });
        }
        previous = { drafts, migrated: [...migrated] };
        readable = true;
        return { state: previous, version: legacy?.version ?? 1 };
      } catch (error) {
        readable = false;
        onError();
        throw error;
      }
    },
    setItem(name, value) {
      if (!readable) {
        onError();
        return;
      }
      const next = value.state;
      if (
        next.drafts === previous.drafts &&
        next.migrated === previous.migrated
      )
        return;
      const saved = new Map<string, TextDraft | null>();
      try {
        const entryPrefix = prefix(name);
        // Save destinations before move tombstones. A quota failure must not
        // erase the source while the destination has not been saved.
        for (const [owner, draft] of Object.entries(next.drafts)) {
          const old = previous.drafts[owner];
          if (
            draft === old ||
            (draft.text === old?.text && draft.revision === old.revision)
          )
            continue;
          localStorage.setItem(
            entryPrefix + encodeURIComponent(owner),
            JSON.stringify(draft),
          );
          saved.set(owner, draft);
        }
        for (const owner of Object.keys(previous.drafts)) {
          if (!Object.hasOwn(next.drafts, owner)) {
            localStorage.setItem(
              entryPrefix + encodeURIComponent(owner),
              "null",
            );
            saved.set(owner, null);
          }
        }
        if (next.migrated !== previous.migrated) {
          const raw = localStorage.getItem(metadata(name));
          const merged = [
            ...new Set([...(raw ? readMarkers(raw) : []), ...next.migrated]),
          ];
          const text = JSON.stringify(merged);
          if (raw !== text) localStorage.setItem(metadata(name), text);
        }
        previous = next;
        onSaved();
      } catch {
        // Retry only unsaved owners. Replaying successful writes on a later
        // edit could overwrite another page's newer draft after a partial save.
        if (saved.size) {
          const drafts = { ...previous.drafts };
          for (const [owner, draft] of saved) {
            if (draft === null) delete drafts[owner];
            else
              Object.defineProperty(drafts, owner, {
                value: draft,
                enumerable: true,
                configurable: true,
                writable: true,
              });
          }
          previous = { ...previous, drafts };
        }
        onError();
      }
    },
    removeItem(name) {
      const entryPrefix = prefix(name);
      for (const key of Object.keys(localStorage)) {
        if (
          key === name ||
          key === metadata(name) ||
          key.startsWith(entryPrefix)
        )
          localStorage.removeItem(key);
      }
      previous = empty();
      readable = true;
    },
  };
}
