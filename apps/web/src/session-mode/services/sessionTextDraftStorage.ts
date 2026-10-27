import type { PersistStorage, StorageValue } from "zustand/middleware";
import { v4 as randomUUID } from "uuid";

export interface TextDraft {
  text: string;
  revision: number;
  /** Identifies an edit across pages whose local revision counters may coincide. */
  writeId?: string;
}
interface TextDraftState {
  drafts: Record<string, TextDraft>;
  migrated: string[];
}
interface StoredDraft extends TextDraft {
  textRef?: true | string;
}

const empty = (): TextDraftState => ({ drafts: {}, migrated: [] });

export const sameTextDraft = (a: TextDraft, b: TextDraft) =>
  a.text === b.text && a.revision === b.revision && a.writeId === b.writeId;

interface TextDraftStorage extends PersistStorage<TextDraftState> {
  clearSubmitted(
    name: string,
    owner: string,
    snapshot: TextDraft,
  ): TextDraft | undefined;
}

function readMarkers(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((kind) => typeof kind === "string"))
    throw new Error("Invalid draft migration markers");
  return value;
}

function readDraft(value: unknown): StoredDraft | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as TextDraft).text !== "string" ||
    !Number.isSafeInteger((value as TextDraft).revision) ||
    (value as TextDraft).revision < 0 ||
    ((value as TextDraft).writeId !== undefined &&
      typeof (value as TextDraft).writeId !== "string")
  )
    throw new Error("Invalid saved text draft");
  return value as StoredDraft;
}

/** Synchronous per-owner saves keep reload safety without serializing every draft per keypress. */
export function createSessionTextDraftStorage(
  onError: () => void,
  onSaved: () => void = () => {},
): TextDraftStorage {
  let previous = empty();
  let readable = true;
  const prefix = (name: string) => `${name}.entry.`;
  const metadata = (name: string) => `${name}.meta`;
  const clearPrefix = (name: string, owner: string) =>
    `${name}.cleared.${encodeURIComponent(owner)}.`;
  const clearKey = (name: string, owner: string, draft: TextDraft) =>
    clearPrefix(name, owner) +
    encodeURIComponent(draft.writeId ?? `legacy-${draft.revision}`);
  const textKey = (
    name: string,
    owner: string,
    writeId: string,
    ref?: true | string,
  ) =>
    `${name}.text.${encodeURIComponent(owner)}.${encodeURIComponent(writeId)}${typeof ref === "string" ? `.${ref}` : ""}`;
  const publishedKey = (name: string, payloadKey: string) =>
    payloadKey.replace(`${name}.text.`, `${name}.published.`);
  const prunePayloads = (name: string, owner: string) => {
    const ownerPrefix = `${name}.text.${encodeURIComponent(owner)}.`;
    for (const key of Object.keys(localStorage).filter((key) =>
      key.startsWith(ownerPrefix),
    )) {
      // Only a completed publication is reclaimable. Pending writers may have
      // saved bytes without publishing their pointer yet. Every attempt has a
      // unique payload address, including retries of the same logical edit.
      const published = publishedKey(name, key);
      if (localStorage.getItem(published) !== "true") continue;
      const current = savedOwner(name, owner);
      if (
        current?.writeId &&
        key === textKey(name, owner, current.writeId, current.textRef)
      )
        continue;
      localStorage.removeItem(key);
      localStorage.removeItem(published);
    }
  };
  const effective = (
    name: string,
    owner: string,
    draft: StoredDraft,
    attempt = 0,
  ): TextDraft | null => {
    const marker = localStorage.getItem(clearKey(name, owner, draft));
    const cleared = draft.writeId
      ? marker === "true"
      : marker === JSON.stringify(draft);
    const removed = draft.writeId
      ? marker === "remove"
      : marker === JSON.stringify({ ...draft, removed: true });
    if (removed) return null;
    if (cleared)
      return {
        text: "",
        revision: draft.revision + 1,
        ...(draft.writeId ? { writeId: `cleared:${draft.writeId}` } : {}),
      };
    if (draft.textRef) {
      if (!draft.writeId) throw new Error("Missing text draft identity");
      const text = localStorage.getItem(
        textKey(name, owner, draft.writeId, draft.textRef),
      );
      if (text === null) {
        // Another page can publish a new pointer and release the old payload
        // after this reader captured the old pointer. Re-read only that owner.
        const latest = savedOwner(name, owner);
        if (!latest) return null;
        if (
          attempt < 3 &&
          (latest.writeId !== draft.writeId || latest.textRef !== draft.textRef)
        )
          return effective(name, owner, latest, attempt + 1);
        // The same edit may have been acknowledged between marker and payload reads.
        if (
          attempt < 3 &&
          localStorage.getItem(clearKey(name, owner, draft)) !== null
        )
          return effective(name, owner, latest, attempt + 1);
        throw new Error("Missing saved text draft");
      }
      return { text, revision: draft.revision, writeId: draft.writeId };
    }
    return draft;
  };
  const savedOwner = (name: string, owner: string): StoredDraft | null => {
    const raw = localStorage.getItem(prefix(name) + encodeURIComponent(owner));
    if (raw !== null) return readDraft(JSON.parse(raw));
    const legacy = localStorage.getItem(name);
    return readDraft(
      legacy ? (JSON.parse(legacy)?.state?.drafts?.[owner] ?? null) : null,
    );
  };
  const mark = (
    name: string,
    owner: string,
    draft: TextDraft,
    removed = false,
  ) => {
    // Text is stored at an immutable edit address. Removing this exact payload
    // cannot remove a concurrent editor's newer payload or pointer.
    localStorage.setItem(
      clearKey(name, owner, draft),
      draft.writeId
        ? removed
          ? "remove"
          : "true"
        : JSON.stringify(removed ? { ...draft, removed: true } : draft),
    );
    if (draft.writeId) {
      const editPrefix = textKey(name, owner, draft.writeId);
      for (const key of Object.keys(localStorage).filter(
        (key) => key === editPrefix || key.startsWith(`${editPrefix}.`),
      )) {
        localStorage.removeItem(key);
        localStorage.removeItem(publishedKey(name, key));
      }
    }
  };
  const pruneMarkers = (name: string, owner: string) => {
    const ownerPrefix = clearPrefix(name, owner);
    for (const key of Object.keys(localStorage).filter((key) =>
      key.startsWith(ownerPrefix),
    )) {
      const live = savedOwner(name, owner);
      if (live && key !== clearKey(name, owner, live))
        localStorage.removeItem(key);
    }
  };
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
        // Freeze keys before resolving payloads: another page can remove old
        // payload keys while we read, shifting live localStorage indexes.
        const entryKeys = Object.keys(localStorage).filter((key) =>
          key.startsWith(entryPrefix),
        );
        for (const key of entryKeys) {
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
        for (const [owner, draft] of Object.entries(drafts)) {
          const resolved = effective(name, owner, draft);
          if (resolved) drafts[owner] = resolved;
          else delete drafts[owner];
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
    clearSubmitted(name, owner, snapshot) {
      if (!readable) {
        onError();
        return undefined;
      }
      try {
        const baseline = previous.drafts[owner];
        // A failed local save must not replace unsaved input with an older
        // persisted value when the send acknowledgement arrives.
        if (!baseline || !sameTextDraft(baseline, snapshot)) return undefined;
        const persisted = savedOwner(name, owner);
        if (!persisted) return undefined;
        const resolved = effective(name, owner, persisted);
        if (resolved && sameTextDraft(resolved, snapshot)) {
          // Never overwrite the text entry in response to an asynchronous ack.
          // A concurrent edit uses a new identity, so this marker cannot clear it
          // even if that edit occurs between our read and write (no localStorage CAS).
          mark(name, owner, snapshot);
        }
        const latest = savedOwner(name, owner);
        if (!latest) return undefined;
        const current = effective(name, owner, latest);
        if (!current) return undefined;
        pruneMarkers(name, owner);
        // The following store update adopts this result without persisting it
        // back over a possible subsequent edit made by another page.
        previous = {
          ...previous,
          drafts: { ...previous.drafts, [owner]: current },
        };
        onSaved();
        return current;
      } catch {
        onError();
        return undefined;
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
          if (draft === old || (old && sameTextDraft(draft, old))) continue;
          const prior = savedOwner(name, owner);
          const key = entryPrefix + encodeURIComponent(owner);
          if (draft.writeId) {
            const ref = randomUUID();
            const payloadKey = textKey(name, owner, draft.writeId, ref);
            localStorage.setItem(payloadKey, draft.text);
            try {
              localStorage.setItem(
                key,
                JSON.stringify({
                  text: "",
                  revision: draft.revision,
                  writeId: draft.writeId,
                  textRef: ref,
                }),
              );
            } catch (error) {
              // The new pointer was not published; never retain an orphaned
              // large payload after quota failure.
              localStorage.removeItem(payloadKey);
              throw error;
            }
            saved.set(owner, draft);
            if (prior?.writeId) {
              const priorKey = textKey(
                name,
                owner,
                prior.writeId,
                prior.textRef,
              );
              localStorage.removeItem(priorKey);
              localStorage.removeItem(publishedKey(name, priorKey));
            }
            localStorage.setItem(publishedKey(name, payloadKey), "true");
            prunePayloads(name, owner);
          } else localStorage.setItem(key, JSON.stringify(draft));
          saved.set(owner, draft);
        }
        for (const owner of Object.keys(previous.drafts)) {
          if (!Object.hasOwn(next.drafts, owner)) {
            const prior = savedOwner(name, owner);
            const source = previous.drafts[owner];
            // A move removes only this page's source version. New input in a
            // different page remains at the original owner.
            const resolved = prior && effective(name, owner, prior);
            if (prior && resolved && sameTextDraft(resolved, source))
              mark(name, owner, prior, true);
            pruneMarkers(name, owner);
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
          key.startsWith(`${name}.cleared.`) ||
          key.startsWith(`${name}.text.`) ||
          key.startsWith(`${name}.published.`) ||
          key.startsWith(entryPrefix)
        )
          localStorage.removeItem(key);
      }
      previous = empty();
      readable = true;
    },
  };
}
