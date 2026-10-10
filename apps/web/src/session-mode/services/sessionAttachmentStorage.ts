import type { ImageAttachment } from "../components/common/useImageAttachments";
import type { ImageDrawing } from "../components/codex/composer/v2/drawing";

const DATABASE = "kanban.session.attachments";
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
function fileBytes(file: File): Promise<ArrayBuffer> {
  const cached = byteReads.get(file);
  if (cached) return cached;
  const pending =
    typeof file.arrayBuffer === "function"
      ? file.arrayBuffer()
      : new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () =>
            reject(reader.error ?? new Error("无法读取附件字节"));
          reader.onabort = () => reject(new Error("附件读取已中断"));
          reader.readAsArrayBuffer(file);
        });
  byteReads.set(file, pending);
  void pending.catch(() => byteReads.delete(file));
  return pending;
}
async function storeFile(file: File): Promise<StoredFile> {
  return {
    bytes: await fileBytes(file),
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
async function storeDrawing(drawing: ImageDrawing): Promise<StoredDrawing> {
  const { originalFile, ...document } = drawing;
  return {
    ...document,
    ...(originalFile
      ? { originalFileData: await storeFile(originalFile) }
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
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("浏览器不支持附件草稿存储"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("附件草稿数据库被占用"));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = work(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error("附件草稿存储已中断"));
    });
  } finally {
    db.close();
  }
}
export async function loadAttachmentDraft(
  owner: string,
): Promise<ImageAttachment[]> {
  const items = await transaction("readonly", (store) => store.get(owner));
  if (!Array.isArray(items)) return [];
  return items.map((item: StoredAttachment) => {
    const { fileData, drawing, ...attachment } = item;
    return {
      ...attachment,
      ...(fileData ? { file: restoreFile(fileData) } : {}),
      ...(drawing ? { drawing: restoreDrawing(drawing) } : {}),
    };
  });
}
export async function saveAttachmentDraft(
  owner: string,
  items: ImageAttachment[],
): Promise<void> {
  // WebKit photo-picker File objects can fail while IndexedDB prepares backing
  // Blob data. Persist actual bytes before upload, not the OS-backed File object.
  // Reconstruct Files on load so retries preserve name/MIME/content exactly.
  const stored: StoredAttachment[] = await Promise.all(
    items.map(async ({ preview: _preview, file, drawing, ...item }) => ({
      ...item,
      preview: "",
      ...(file
        ? {
            fileData: await storeFile(file),
          }
        : {}),
      ...(drawing
        ? {
            drawing: await storeDrawing(drawing),
          }
        : {}),
    })),
  );
  if (stored.length)
    await transaction("readwrite", (store) => store.put(stored, owner));
  else await transaction("readwrite", (store) => store.delete(owner));
}
