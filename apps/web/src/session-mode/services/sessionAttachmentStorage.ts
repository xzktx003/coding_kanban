import type { ImageAttachment } from "../components/common/useImageAttachments";

const DATABASE = "kanban.session.attachments";
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
  return Array.isArray(items) ? items : [];
}
export async function saveAttachmentDraft(
  owner: string,
  items: ImageAttachment[],
): Promise<void> {
  // Object URLs cannot survive a reload; File bytes and uploaded paths can.
  const stored = items.map(({ preview: _preview, ...item }) => ({
    ...item,
    preview: "",
  }));
  if (stored.length)
    await transaction("readwrite", (store) => store.put(stored, owner));
  else await transaction("readwrite", (store) => store.delete(owner));
}
