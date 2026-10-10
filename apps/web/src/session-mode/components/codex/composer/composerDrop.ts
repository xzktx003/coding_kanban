import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import { toast } from "sonner";
import { composerDrafts } from "./v2/drafts";

function containsFiles(transfer: DataTransfer) {
  return (
    transfer.files.length > 0 || Array.from(transfer.types).includes("Files")
  );
}

/** Native composer fAi/nma separates images from other files. A browser file
 * has no trusted server path: retain its UTF-8 snapshot rather than inventing
 * a path or passing an ordinary file as a native localImage. */
export function useComposerFileDrop(
  owner: string,
  {
    addImages,
    disabled,
  }: { addImages: (files: File[]) => unknown; disabled: boolean },
) {
  const [hoverOwner, setHoverOwner] = useState<string | null>(null);
  useEffect(() => setHoverOwner(null), [owner, disabled]);
  const [pendingOwners, setPendingOwners] = useState<Record<string, number>>(
    {},
  );
  async function addTextFiles(files: File[]) {
    setPendingOwners((s) => ({ ...s, [owner]: (s[owner] ?? 0) + 1 }));
    try {
      const contexts = await Promise.all(
        files.map(async (file) => {
          try {
            if (file.size > 10 * 1024 * 1024)
              throw new Error("文件不能超过 10 MB");
            const bytes = await file.arrayBuffer();
            let text: string;
            try {
              text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            } catch {
              throw new Error("请选择 UTF-8 文本或代码文件");
            }
            if (text.includes("\0"))
              throw new Error("二进制文件不能作为文本上下文");
            if (text.length > 180_000)
              throw new Error("文件过长，请选择需要的片段后引用");
            return {
              id: crypto.randomUUID(),
              kind: "file" as const,
              name: file.name || "文本文件",
              text,
            };
          } catch (error) {
            toast.error(
              `${file.name || "文件"}：${error instanceof Error ? error.message : "读取失败"}`,
            );
            return null;
          }
        }),
      );
      for (const context of contexts)
        if (context) composerDrafts.add(owner, context);
    } finally {
      setPendingOwners((s) => ({
        ...s,
        [owner]: Math.max(0, (s[owner] ?? 1) - 1),
      }));
    }
  }
  function onDragOver(event: DragEvent) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    setHoverOwner(disabled ? null : owner);
  }
  function onDragLeave(event: DragEvent) {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    )
      return;
    setHoverOwner(null);
  }
  function onDrop(event: DragEvent) {
    setHoverOwner(null);
    if (!containsFiles(event.dataTransfer)) return;
    // Capture before Lexical: file drops must not become editor text, navigation,
    // or a passive focus change. Text and session-tab drags retain their handlers.
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    const images = files.filter((file) => file.type.startsWith("image/"));
    const text = files.filter((file) => !file.type.startsWith("image/"));
    if (images.length) addImages(images);
    if (text.length) void addTextFiles(text);
  }
  return {
    onDragOver,
    onDragLeave,
    onDrop,
    active: hoverOwner === owner && !disabled,
    pending: !!pendingOwners[owner],
  };
}
