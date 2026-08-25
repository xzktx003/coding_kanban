import type {
  FilePreviewInput,
  FilePreviewResponse,
} from "@agent-orchestrator/shared";

import { previewFile } from "./api";

export const DESKTOP_MARKDOWN_PREVIEW_PAGE_BYTES = 256 * 1024;
export const DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES = 1024 * 1024;

export interface MarkdownPreviewWindow {
  bytesRead: number;
  complete: boolean;
  content: string;
  nextOffset: number | null;
  offset: number;
  path: string;
  size: number;
}

type PreviewLoader = (input: FilePreviewInput) => Promise<FilePreviewResponse>;

export async function loadMarkdownPreviewWindow(
  input: Omit<FilePreviewInput, "maxBytes">,
  loadPreview: PreviewLoader = previewFile,
): Promise<MarkdownPreviewWindow> {
  const requestedOffset = input.offset ?? 0;
  const chunks: string[] = [];
  let bytesRead = 0;
  let nextOffset: number | null = requestedOffset;
  let firstOffset = requestedOffset;
  let fileSize = 0;

  while (
    nextOffset !== null &&
    bytesRead < DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES
  ) {
    const requestOffset = nextOffset;
    const response = await loadPreview({
      ...input,
      maxBytes: Math.min(
        DESKTOP_MARKDOWN_PREVIEW_PAGE_BYTES,
        DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES - bytesRead,
      ),
      offset: requestOffset,
    });
    if (response.encoding !== "utf8") {
      throw new Error("Markdown 文件不是 UTF-8 文本");
    }
    if (chunks.length === 0) {
      firstOffset = response.offset;
      fileSize = response.size;
    }

    chunks.push(response.content);
    bytesRead += response.bytesRead;
    nextOffset = response.nextOffset;

    if (
      nextOffset !== null &&
      (response.bytesRead <= 0 || nextOffset <= requestOffset)
    ) {
      throw new Error("Markdown 分段没有继续向后推进");
    }
  }

  return {
    bytesRead,
    complete: firstOffset === 0 && nextOffset === null,
    content: chunks.join(""),
    nextOffset,
    offset: firstOffset,
    path: input.path,
    size: fileSize,
  };
}
