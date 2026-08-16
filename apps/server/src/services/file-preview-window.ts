import type { FilePreviewResponse } from "@agent-orchestrator/shared";

import { guessMimeType, isBinaryBuffer } from "./file-system-utils.js";

export const DEFAULT_FILE_PREVIEW_BYTES = 64 * 1024;
export const MAX_FILE_PREVIEW_BYTES = 256 * 1024;
const MIN_FILE_PREVIEW_BYTES = 4;

export interface NormalizedFilePreviewWindow {
  offset: number;
  maxBytes: number;
  readBytes: number;
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field} cannot be negative or non-integer`);
  }
  return normalized;
}

export function normalizeFilePreviewWindow(
  fileSize: number,
  maxBytes?: number,
  offset?: number,
): NormalizedFilePreviewWindow {
  const normalizedSize = Math.max(0, Number(fileSize) || 0);
  const normalizedOffset = Math.min(
    normalizeNonNegativeInteger(offset, 0, "offset"),
    normalizedSize,
  );
  const requestedBytes = normalizeNonNegativeInteger(
    maxBytes,
    DEFAULT_FILE_PREVIEW_BYTES,
    "maxBytes",
  );
  if (requestedBytes === 0) {
    throw new Error("maxBytes cannot be zero");
  }
  // Four bytes guarantee that even a leading UTF-8 code point can advance
  // the window instead of returning an empty page at the same offset.
  const boundedBytes = Math.min(
    Math.max(requestedBytes, MIN_FILE_PREVIEW_BYTES),
    MAX_FILE_PREVIEW_BYTES,
  );

  return {
    offset: normalizedOffset,
    maxBytes: boundedBytes,
    // Up to three extra bytes let a window skip UTF-8 continuation bytes
    // without shrinking its useful payload. The response remains maxBytes.
    readBytes: Math.min(normalizedSize - normalizedOffset, boundedBytes + 3),
  };
}

function isUtf8ContinuationByte(value: number): boolean {
  return (value & 0xc0) === 0x80;
}

function utf8SequenceLength(value: number): number {
  if ((value & 0x80) === 0) return 1;
  if ((value & 0xe0) === 0xc0) return 2;
  if ((value & 0xf0) === 0xe0) return 3;
  if ((value & 0xf8) === 0xf0) return 4;
  return 1;
}

function findCompleteUtf8End(
  buffer: Buffer,
  start: number,
  end: number,
): number {
  if (end <= start) return start;

  let leadIndex = end - 1;
  while (
    leadIndex >= start &&
    end - leadIndex <= 3 &&
    isUtf8ContinuationByte(buffer[leadIndex] ?? 0)
  ) {
    leadIndex -= 1;
  }
  if (leadIndex < start) return end;

  const expectedLength = utf8SequenceLength(buffer[leadIndex] ?? 0);
  return end - leadIndex < expectedLength ? leadIndex : end;
}

export function buildFilePreviewResponse({
  path,
  buffer,
  fileSize,
  offset,
  maxBytes,
}: {
  path: string;
  buffer: Buffer;
  fileSize: number;
  offset: number;
  maxBytes: number;
}): FilePreviewResponse {
  const binary = isBinaryBuffer(buffer);
  let contentStart = 0;

  if (!binary && offset > 0) {
    while (
      contentStart < Math.min(buffer.length, 3) &&
      isUtf8ContinuationByte(buffer[contentStart] ?? 0)
    ) {
      contentStart += 1;
    }
  }

  const rawEnd = Math.min(buffer.length, contentStart + maxBytes);
  const contentEnd = binary
    ? rawEnd
    : findCompleteUtf8End(buffer, contentStart, rawEnd);
  const contentBuffer = buffer.subarray(contentStart, contentEnd);
  const effectiveOffset = offset + contentStart;
  const nextOffset =
    effectiveOffset + contentBuffer.length < fileSize
      ? effectiveOffset + contentBuffer.length
      : null;

  return {
    path,
    content: binary
      ? contentBuffer.toString("base64")
      : contentBuffer.toString("utf8"),
    encoding: binary ? "binary" : "utf8",
    truncated: nextOffset !== null,
    size: fileSize,
    mimeType: guessMimeType(path),
    offset: effectiveOffset,
    bytesRead: contentBuffer.length,
    previousOffset:
      effectiveOffset > 0 ? Math.max(0, effectiveOffset - maxBytes) : null,
    nextOffset,
  };
}
