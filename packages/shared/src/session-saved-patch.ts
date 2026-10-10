/** Immutable native file-change receipts, in their original item order. */
export interface SavedPatchChange {
  path: string;
  kind: { type: "add" | "delete" | "update"; move_path?: string | null };
  diff: string;
}
export interface SavedPatchBatch {
  id: string;
  changes: SavedPatchChange[];
}
export interface SavedPatchRequest {
  requestId: string;
  threadId: string;
  turnId: string;
  action: "undo" | "reapply";
  expectedChanges: SavedPatchBatch[];
  /** Optional original file path. Omission applies all saved batches. */
  filePath?: string;
}
export interface SavedPatchResult {
  requestId: string;
  status: "success" | "conflict" | "uncertain";
  action: "undo" | "reapply";
  changedFiles: number;
  error?: string;
}
