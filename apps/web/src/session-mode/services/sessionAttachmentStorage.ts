import type { ImageAttachment } from "../components/common/useImageAttachments";
import type { ImageDrawing } from "../components/codex/composer/v2/drawing";
import { readWithDeadline } from "./sessionReadQueue";

const DATABASE = "kanban.session.attachments";
function storageDeadline<T>(work: (signal: AbortSignal) => Promise<T>) {
  return readWithDeadline(work, 10_000).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error("附件草稿存储超时，请重试");
    throw error;
  });
}
type StoredFile = {
  bytes: ArrayBuffer;
  name: string;
  type: string;
  lastModified: number;
};
type StoredDrawing = ImageDrawing & { originalFileData?: StoredFile };
type StoredAttachment = Omit<ImageAttachment, "file" | "drawing"> & {
  file?: File; // Read older records without rewriting them on load.
  fileData?: StoredFile;
  drawing?: StoredDrawing;
};
const byteReads = new WeakMap<File, Promise<ArrayBuffer>>();
function fileBytes(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const cached = byteReads.get(file);
  const pending =
    cached ??
    (typeof file.arrayBuffer === "function"
      ? file.arrayBuffer()
      : new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () =>
            reject(reader.error ?? new Error("无法读取附件字节"));
          reader.onabort = () => reject(new Error("附件读取已中断"));
          reader.readAsArrayBuffer(file);
        }));
  byteReads.set(file, pending);
  // A stalled OS-backed File must be readable again on explicit retry. Do not
  // let an old failure erase a newer cached read of the same file.
  const forget = () => {
    if (byteReads.get(file) === pending) byteReads.delete(file);
  };
  signal.addEventListener("abort", forget, { once: true });
  void pending.then(
    () => signal.removeEventListener("abort", forget),
    () => {
      signal.removeEventListener("abort", forget);
      forget();
    },
  );
  return pending;
}
async function storeFile(file: File, signal: AbortSignal): Promise<StoredFile> {
  return {
    bytes: await fileBytes(file, signal),
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
  };
}
function restoreFile(data: StoredFile): File {
  if (
    Object.prototype.toString.call(data.bytes) !== "[object ArrayBuffer]" ||
    typeof data.name !== "string" ||
    typeof data.type !== "string" ||
    !Number.isFinite(data.lastModified)
  )
    throw new Error("附件字节草稿损坏，请保留浏览器数据后恢复");
  return new File([data.bytes], data.name, {
    type: data.type,
    lastModified: data.lastModified,
  });
}
async function storeDrawing(
  drawing: ImageDrawing,
  signal: AbortSignal,
): Promise<StoredDrawing> {
  const { originalFile, ...document } = drawing;
  return {
    ...document,
    ...(originalFile
      ? { originalFileData: await storeFile(originalFile, signal) }
      : {}),
  };
}
function restoreDrawing(drawing: StoredDrawing): ImageDrawing {
  const { originalFileData, ...document } = drawing;
  return {
    ...document,
    ...(originalFileData
      ? { originalFile: restoreFile(originalFileData) }
      : {}),
  };
}
function open(signal: AbortSignal): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    if (!globalThis.indexedDB) {
      reject(new Error("浏览器不支持附件草稿存储"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const finish = (error?: unknown, database?: IDBDatabase) => {
      if (settled) {
        // IDB open requests cannot be cancelled. Release a late connection
        // instead of letting the expired operation continue or block upgrades.
        database?.close();
        return;
      }
      settled = true;
      signal.removeEventListener("abort", cancel);
      if (error !== undefined) reject(error);
      else resolve(database!);
    };
    const cancel = () => finish(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    request.onupgradeneeded = () => {
      if (settled || signal.aborted) request.transaction?.abort();
      else request.result.createObjectStore("drafts");
    };
    request.onerror = () =>
      finish(request.error ?? new Error("附件草稿数据库无法打开"));
    request.onblocked = () => finish(new Error("附件草稿数据库被占用"));
    request.onsuccess = () => finish(undefined, request.result);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
  signal: AbortSignal,
): Promise<T> {
  const db = await open(signal);
  try {
    return await new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const tx = db.transaction("drafts", mode);
      let settled = false;
      let request: IDBRequest<T>;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        if (error !== undefined) reject(error);
        else resolve(value as T);
      };
      const cancel = () => {
        // A timeout must not leave an old write alive to overwrite a retry.
        try {
          tx.abort();
        } catch {}
        finish(signal.reason);
      };
      signal.addEventListener("abort", cancel, { once: true });
      tx.oncomplete = () => finish(undefined, request.result);
      tx.onerror = () =>
        finish(tx.error ?? request.error ?? new Error("附件草稿存储失败"));
      tx.onabort = () =>
        finish(
          signal.aborted
            ? signal.reason
            : (tx.error ?? new Error("附件草稿存储已中断")),
        );
      try {
        request = work(tx.objectStore("drafts"));
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        finish(error);
      }
    });
  } finally {
    db.close();
  }
}
export async function loadAttachmentDraft(
  owner: string,
): Promise<ImageAttachment[]> {
  return storageDeadline(async (signal) => {
    const items = await transaction(
      "readonly",
      (store) => store.get(owner),
      signal,
    );
    if (!Array.isArray(items)) return [];
    return items.map((item: StoredAttachment) => {
      const { fileData, drawing, ...attachment } = item;
      return {
        ...attachment,
        ...(fileData ? { file: restoreFile(fileData) } : {}),
        ...(drawing ? { drawing: restoreDrawing(drawing) } : {}),
      };
    });
  });
}
export async function saveAttachmentDraft(
  owner: string,
  items: ImageAttachment[],
  previous: ImageAttachment[] = [],
): Promise<{ discardedIds: string[] }> {
  return storageDeadline(async (signal) => {
    const before = new Map(previous.map((item) => [item.id, item]));
    const nextIds = new Set(items.map((item) => item.id));
    const removed = new Set(
      previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id),
    );
    // WebKit photo-picker File objects can fail while IndexedDB prepares backing
    // Blob data. Persist actual bytes before upload, not the OS-backed File object.
    // Reconstruct Files on load so retries preserve name/MIME/content exactly.
    const stored: StoredAttachment[] = await Promise.all(
      items
        .filter((item) => item !== before.get(item.id))
        .map(async ({ preview: _preview, file, drawing, ...item }) => ({
          ...item,
          preview: "",
          ...(file
            ? {
                fileData: await storeFile(file, signal),
              }
            : {}),
          ...(drawing
            ? {
                drawing: await storeDrawing(drawing, signal),
              }
            : {}),
        })),
    );
    const discardedIds: string[] = [];
    await editDrafts(
      [owner],
      (drafts) => {
        const current = drafts.get(owner)!;
        const existingIds = new Set(current.map((item) => item.id));
        const changes = new Map(stored.map((item) => [item.id, item]));
        // An update is never an insertion: another page may already have removed
        // this ID while its upload or submitted-message acknowledgement was pending.
        for (const item of items)
          if (before.has(item.id) && !existingIds.has(item.id))
            discardedIds.push(item.id);
        const originals = new Map(items.map((item) => [item.id, item]));
        const merged = current
          .filter((item) => !removed.has(item.id))
          .map((item) => {
            const change = changes.get(item.id),
              old = before.get(item.id),
              next = originals.get(item.id);
            if (!change || !old || !next) return item;
            const result = { ...item } as unknown as Record<string, unknown>;
            // A late upload changes path/status, not the name or drawing another
            // page may have edited. Merge only fields this page actually changed.
            for (const field of new Set([
              ...Object.keys(old),
              ...Object.keys(next),
            ])) {
              if (
                field === "id" ||
                field === "preview" ||
                old[field as keyof ImageAttachment] ===
                  next[field as keyof ImageAttachment]
              )
                continue;
              const storedField = field === "file" ? "fileData" : field;
              const value = (change as unknown as Record<string, unknown>)[
                storedField
              ];
              if (value === undefined) delete result[storedField];
              else result[storedField] = value;
              if (field === "file") delete result.file;
            }
            return result as unknown as StoredAttachment;
          });
        for (const item of stored)
          if (!before.has(item.id) && !existingIds.has(item.id))
            merged.push(item);
        drafts.set(owner, merged);
      },
      signal,
    );
    return { discardedIds };
  });
}

/** Read and write all affected owners in one IDB transaction. Byte reads happen before entry. */
async function editDrafts(
  owners: string[],
  update: (drafts: Map<string, StoredAttachment[]>) => void,
  signal: AbortSignal,
) {
  let failure: unknown;
  await transaction(
    "readwrite",
    (store) => {
      const drafts = new Map<string, StoredAttachment[]>();
      const requests = owners.map((owner) => {
        const request = store.get(owner);
        request.onsuccess = () => {
          try {
            if (request.result !== undefined && !Array.isArray(request.result))
              throw new Error("附件草稿损坏，请保留浏览器数据后恢复");
            drafts.set(owner, request.result ?? []);
            if (drafts.size !== owners.length) return;
            update(drafts);
            for (const [key, items] of drafts) {
              if (items.length) store.put(items, key);
              else store.delete(key);
            }
          } catch (error) {
            failure = error;
            store.transaction.abort();
          }
        };
        return request;
      });
      return requests[0];
    },
    signal,
  ).catch((error) => {
    throw failure ?? error;
  });
}

/** Move only captured IDs; unread additions stay at their original owner. Commit both owners atomically. */
export async function moveAttachmentDraft(
  from: string,
  to: string,
  ids: string[],
) {
  if (from === to) return { discardedIds: [] as string[] };
  const discardedIds: string[] = [];
  await storageDeadline((signal) =>
    editDrafts(
      [from, to],
      (drafts) => {
        const wanted = new Set(ids),
          source = drafts.get(from)!,
          target = drafts.get(to)!;
        const existing = new Set(target.map((item) => item.id));
        for (const id of ids)
          if (!existing.has(id) && !source.some((item) => item.id === id))
            discardedIds.push(id);
        drafts.set(to, [
          ...target,
          ...source.filter(
            (item) => wanted.has(item.id) && !existing.has(item.id),
          ),
        ]);
        drafts.set(
          from,
          source.filter((item) => !wanted.has(item.id)),
        );
      },
      signal,
    ),
  );
  return { discardedIds };
}
