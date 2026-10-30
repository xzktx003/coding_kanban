/** Stable management identity. Runtime generations never belong in this key. */
export type ManagedSessionKind = "codex" | "cc" | "acp";
export interface ManagedSessionTarget { namespace: string; kind: ManagedSessionKind; id: string }
export interface SessionManagementEntry extends ManagedSessionTarget {
  revision: number;
  pinRevision: number;
  pinned: boolean;
  title?: string;
  cwd?: string;
  manualUnreadRevision: number;
  completed: Array<{ id: string; at: number }>;
  read: string[];
}
export type SessionManagementAction =
  | { type: "pin"; value: boolean; expectedRevision: number; title?: string; cwd?: string }
  | { type: "complete"; replyId: string }
  | { type: "read"; replyId: string; manualUnreadRevision: number; nativeReadRevision?: string; nativeScope?: string }
  | { type: "unread"; nativeReadRevision?: string; nativeScope?: string };
export interface SessionManagementOperation { operationId: string; windowId?: string; target: ManagedSessionTarget; action: SessionManagementAction }
export interface SharedSessionManagement {
  revision: number;
  operationWindow: { id: string; expiresAt: number };
  namespaces: Record<ManagedSessionKind, string | null>;
  entries: SessionManagementEntry[];
}
export const managedSessionKey = (target: ManagedSessionTarget) => JSON.stringify([target.namespace, target.kind, target.id]);
