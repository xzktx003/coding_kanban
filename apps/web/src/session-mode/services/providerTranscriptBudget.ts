import {
  CODEX_TRANSCRIPT_MAX_BYTES,
  estimateTranscriptBytes,
} from "./codexTranscriptMemoryBudget";

export const PROVIDER_TRANSCRIPT_MAX_ROWS = 600;
export class ProviderTranscriptAdmissionError extends Error {
  constructor() {
    super(
      "消息超过当前显示预算，请重试读取近期消息；任务和待审批操作不会被停止。",
    );
    this.name = "ProviderTranscriptAdmissionError";
  }
}

/** A display window, never an execution-history deletion. The edge being read stays. */
export function admitProviderTranscriptRows<T>(
  rows: T[],
  options: { edge?: "latest" | "earlier"; pinned?: (row: T) => boolean } = {},
) {
  const sizes = rows.map((row) => estimateTranscriptBytes(row));
  let bytes = 24 + sizes.reduce((sum, size) => sum + size, 0);
  let count = rows.length;
  if (
    bytes <= CODEX_TRANSCRIPT_MAX_BYTES &&
    count <= PROVIDER_TRANSCRIPT_MAX_ROWS
  )
    return { rows, trimmed: false, bytes };
  const removed = new Set<number>();
  const order = rows.map((_, index) => index);
  if (options.edge === "earlier") order.reverse();
  const boundary = options.edge === "earlier" ? 0 : rows.length - 1;
  for (const index of order) {
    if (
      bytes <= CODEX_TRANSCRIPT_MAX_BYTES &&
      count <= PROVIDER_TRANSCRIPT_MAX_ROWS
    )
      break;
    if (index === boundary || options.pinned?.(rows[index])) continue;
    removed.add(index);
    bytes -= sizes[index];
    count--;
  }
  // An irreducible attachment or approval cannot be silently clipped or erased.
  // Reject before publishing; the caller retains its previous bounded body.
  if (
    bytes > CODEX_TRANSCRIPT_MAX_BYTES ||
    count > PROVIDER_TRANSCRIPT_MAX_ROWS
  )
    throw new ProviderTranscriptAdmissionError();
  return {
    rows: rows.filter((_, index) => !removed.has(index)),
    trimmed: true,
    bytes,
  };
}
