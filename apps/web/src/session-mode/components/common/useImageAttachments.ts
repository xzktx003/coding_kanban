import { useEffect } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import type { ClipboardEvent } from "react";
import { uploadBrowserFile } from "@session/browser-dialog";
import {
  loadAttachmentDraft,
  saveAttachmentDraft,
} from "@session/services/sessionAttachmentStorage";

export interface ImageAttachment {
  id: string;
  name: string;
  preview: string;
  file?: File;
  path?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
}
const EMPTY: ImageAttachment[] = [];
export const useAttachmentDraftStore = create<{
  drafts: Record<string, ImageAttachment[]>;
  hydrated: Record<string, boolean>;
  errors: Record<string, string | undefined>;
}>(() => ({ drafts: {}, hydrated: {}, errors: {} }));
const loads = new Map<string, Promise<void>>();
const writes = new Map<string, Promise<void>>();
function report(owner: string, error: unknown) {
  const message = error instanceof Error ? error.message : "浏览器存储失败";
  if (!useAttachmentDraftStore.getState().errors[owner])
    toast.error(`附件草稿未能保存：${message}`);
  useAttachmentDraftStore.setState((s) => ({
    errors: { ...s.errors, [owner]: message },
  }));
}
function persist(owner: string) {
  const items = useAttachmentDraftStore.getState().drafts[owner] ?? EMPTY;
  const pending = (writes.get(owner) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await saveAttachmentDraft(owner, items);
      useAttachmentDraftStore.setState((s) => ({
        errors: { ...s.errors, [owner]: undefined },
      }));
    });
  writes.set(owner, pending);
  void pending.catch((error) => report(owner, error));
  return pending;
}
export const flushAttachmentDraft = (owner: string) =>
  writes.get(owner) ?? Promise.resolve();
export function ensureAttachmentDraft(owner: string): Promise<void> {
  if (useAttachmentDraftStore.getState().hydrated[owner])
    return Promise.resolve();
  if (loads.has(owner)) return loads.get(owner)!;
  const pending = (async () => {
    try {
      const saved = await loadAttachmentDraft(owner);
      const restored = saved.map((item) => ({
        ...item,
        preview:
          item.file && typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(item.file)
            : "",
        ...(item.status === "uploading"
          ? { status: "error" as const, error: "上传已中断，点击重试" }
          : {}),
      }));
      useAttachmentDraftStore.setState((s) => {
        const current = s.drafts[owner] ?? EMPTY;
        const ids = new Set(current.map((item) => item.id));
        return {
          drafts: {
            ...s.drafts,
            [owner]: [
              ...restored.filter((item) => !ids.has(item.id)),
              ...current,
            ],
          },
          hydrated: { ...s.hydrated, [owner]: true },
          errors: { ...s.errors, [owner]: undefined },
        };
      });
    } catch (error) {
      // Never overwrite unread persistent data after a read failure.
      report(owner, error);
      throw error;
    } finally {
      loads.delete(owner);
    }
  })();
  loads.set(owner, pending);
  return pending;
}
function update(
  owner: string,
  action: (items: ImageAttachment[]) => ImageAttachment[],
) {
  useAttachmentDraftStore.setState((s) => ({
    drafts: { ...s.drafts, [owner]: action(s.drafts[owner] ?? EMPTY) },
  }));
  if (useAttachmentDraftStore.getState().hydrated[owner]) void persist(owner);
}
function itemOwner(owner: string, id: string) {
  const drafts = useAttachmentDraftStore.getState().drafts;
  if (drafts[owner]?.some((item) => item.id === id)) return owner;
  return Object.keys(drafts).find((key) =>
    drafts[key].some((item) => item.id === id),
  );
}
function updateItem(
  owner: string,
  id: string,
  action: (item: ImageAttachment) => ImageAttachment,
) {
  const target = itemOwner(owner, id);
  if (target)
    update(target, (items) =>
      items.map((item) => (item.id === id ? action(item) : item)),
    );
}
function release(item: ImageAttachment) {
  if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
}
export async function moveImageDraft(from: string, to: string) {
  if (from === to) return;
  await Promise.all([ensureAttachmentDraft(from), ensureAttachmentDraft(to)]);
  useAttachmentDraftStore.setState((s) => {
    const source = s.drafts[from] ?? EMPTY,
      target = s.drafts[to] ?? EMPTY;
    const ids = new Set(target.map((item) => item.id));
    return {
      drafts: {
        ...s.drafts,
        [from]: [],
        [to]: [...target, ...source.filter((item) => !ids.has(item.id))],
      },
    };
  });
  await Promise.all([persist(from), persist(to)]);
}

export function useImageAttachments(owner: string) {
  const attachments = useAttachmentDraftStore((s) => s.drafts[owner] ?? EMPTY);
  const hydrated = useAttachmentDraftStore((s) => s.hydrated[owner] ?? false);
  const storageError = useAttachmentDraftStore((s) => s.errors[owner]);
  useEffect(() => {
    void ensureAttachmentDraft(owner).catch(() => {});
  }, [owner]);
  async function upload(item: ImageAttachment) {
    updateItem(owner, item.id, (value) => ({
      ...value,
      status: "uploading",
      error: undefined,
    }));
    try {
      await ensureAttachmentDraft(owner);
      // File bytes must be committed before an upload begins, so an interrupted upload is recoverable.
      await flushAttachmentDraft(itemOwner(owner, item.id) ?? owner);
      const path = await uploadBrowserFile(item.file!);
      updateItem(owner, item.id, (value) => ({
        ...value,
        status: "ready",
        path,
      }));
    } catch (error) {
      updateItem(owner, item.id, (value) => ({
        ...value,
        status: "error",
        error: error instanceof Error ? error.message : "上传失败",
      }));
    }
  }
  function addFiles(files: File[]) {
    const items: ImageAttachment[] = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name || "剪贴板图片",
      file,
      preview:
        typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(file)
          : "",
      status: file.size > 10 * 1024 * 1024 ? "error" : "uploading",
      error: file.size > 10 * 1024 * 1024 ? "图片不能超过 10 MB" : undefined,
    }));
    update(owner, (previous) => [...previous, ...items]);
    void ensureAttachmentDraft(owner)
      .then(async () => {
        await persist(owner);
        for (const item of items)
          if (item.status === "uploading") void upload(item);
      })
      .catch((error) => {
        // Retain files in memory and show an explicit persistence failure instead of dropping them.
        for (const item of items)
          updateItem(owner, item.id, (current) => ({
            ...current,
            status: "error",
            error: String(error),
          }));
      });
  }
  function onPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length)
      for (const item of Array.from(event.clipboardData.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }
  function clear(ids = attachments.map((item) => item.id)) {
    const targets = new Set(
      ids
        .map((id) => itemOwner(owner, id))
        .filter((key): key is string => !!key),
    );
    for (const target of targets)
      update(target, (items) => {
        items.filter((item) => ids.includes(item.id)).forEach(release);
        return items.filter((item) => !ids.includes(item.id));
      });
  }
  return {
    attachments,
    storageError,
    retryStorage: () =>
      ensureAttachmentDraft(owner)
        .then(() => persist(owner))
        .catch((error) => report(owner, error)),
    paths: attachments.flatMap((item) =>
      item.status === "ready" && item.path ? [item.path] : [],
    ),
    blocked: !hydrated || attachments.some((item) => item.status !== "ready"),
    onPaste,
    addFiles,
    clear,
    remove: (id: string) => clear([id]),
    retry: async (id: string) => {
      try {
        await ensureAttachmentDraft(owner);
        // Save memory-only files again after storage recovers.
        await persist(owner);
        const item = useAttachmentDraftStore
          .getState()
          .drafts[owner]?.find((value) => value.id === id);
        if (item?.file && item.file.size <= 10 * 1024 * 1024)
          await upload(item);
      } catch (error) {
        report(owner, error);
      }
    },
    addPaths: (paths: string[]) =>
      update(owner, (items) => [
        ...items,
        ...paths.map((path) => ({
          id: crypto.randomUUID(),
          name: path.split("/").at(-1) ?? "图片",
          path,
          preview: "",
          status: "ready" as const,
        })),
      ]),
  };
}
