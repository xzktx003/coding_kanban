export type DesktopPaneEdge = "left" | "right" | "top" | "bottom" | "center";
export interface DesktopPaneGroup {
  readonly type: "group";
  readonly id: string;
  readonly keys: readonly string[];
  readonly selected: string | null;
  readonly keepEmpty?: true;
}
export interface DesktopPaneBranch {
  readonly type: "split";
  readonly id: string;
  readonly direction: "horizontal" | "vertical";
  readonly ratio: number;
  readonly first: DesktopPaneNode;
  readonly second: DesktopPaneNode;
}
export type DesktopPaneNode = DesktopPaneGroup | DesktopPaneBranch;
export interface DesktopPaneSnapshot {
  readonly version: 1;
  readonly tree: DesktopPaneNode;
  readonly activeGroupId: string;
  readonly revision: number;
}
export interface DesktopPaneLayout {
  getSnapshot(): DesktopPaneSnapshot;
  serialize(): string;
  subscribe(listener: () => void): () => void;
  open(key: string, groupId?: string): boolean;
  focus(key: string): boolean;
  focusGroup(id: string): boolean;
  place(
    key: string,
    targetId: string,
    edge: DesktopPaneEdge,
    beforeKey?: string,
  ): boolean;
  mergeGroups(sourceId: string, targetId: string): boolean;
  close(key: string): boolean;
  closeGroup(id: string): boolean;
  closeEmptyGroup(id: string): boolean;
  resize(id: string, ratio: number): boolean;
  reconcile(allowedKeys: readonly string[]): boolean;
}
/** Presentation state only. A key or active group never grants native authority. */
export function createDesktopPaneLayout(options?: {
  /** Fresh document-local IDs; must not intentionally recycle retired IDs. */
  idFactory?: () => string;
  saved?: string;
}): DesktopPaneLayout;
