import type { SshTarget } from "@agent-orchestrator/shared";

import { fetchFileDownload, parseFailedResponseMessage } from "./api";

const PDF_SIGNATURE = "%PDF-";
const PDF_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/acrobat",
  "applications/vnd.pdf",
  "text/pdf",
  "text/x-pdf",
]);

export function isPdfFile(name: string, mimeType?: string | null): boolean {
  const normalizedMimeType = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedMimeType && PDF_MIME_TYPES.has(normalizedMimeType)) {
    return true;
  }

  return name.trim().toLowerCase().endsWith(".pdf");
}

export async function fetchPdfPreview(
  body: { path: string; sshTarget?: SshTarget },
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchFileDownload(body, signal);

  if (!response.ok) {
    throw new Error(await parseFailedResponseMessage(response));
  }

  const buffer = await response.arrayBuffer();
  const signature = new TextDecoder()
    .decode(new Uint8Array(buffer.slice(0, PDF_SIGNATURE.length)))
    .trim();
  if (signature !== PDF_SIGNATURE) {
    throw new Error("服务器返回了非 PDF 内容");
  }

  return new Blob([buffer], { type: "application/pdf" });
}
