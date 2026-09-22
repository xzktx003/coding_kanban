export interface PageRenameGesture {
  cancelled: boolean;
}

export function beginPageRename(): PageRenameGesture {
  return { cancelled: false };
}

export function pageRenameKeyAction(
  key: string,
): "commit" | "cancel" | "ignore" {
  if (key === "Enter") {
    return "commit";
  }
  if (key === "Escape") {
    return "cancel";
  }
  return "ignore";
}

export function markPageRenameCancelled(
  gesture: PageRenameGesture,
): PageRenameGesture {
  return { ...gesture, cancelled: true };
}

export function shouldCommitPageRename(gesture: PageRenameGesture): boolean {
  return !gesture.cancelled;
}
