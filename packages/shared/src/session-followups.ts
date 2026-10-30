import type { NativeInputMention } from "./session-subagents.js";
import type { ComposerContext } from "./composer-context.js";
export type FollowupMode = "queue" | "steer" | "replace";
export type FollowupStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "uncertain"
  | "cancelled";
export type NativeSteerReference =
  | { type: "image" | "audio"; url: string }
  | { type: "localImage" | "localAudio"; path: string }
  | { type: "mention" | "skill"; name: string; path: string };
/** Display provenance for an accepted in-turn supplement. Never a native item or pending work. */
export interface NativeSteerReceipt {
  sourceId: string;
  operationId: string;
  clientId: string;
  threadId: string;
  turnId: string;
  scope?: string;
  namespace?: string;
  createdAt: number;
  status: "accepted";
  /** Unique among this namespace's durable display sources, never a native CAS guarantee. */
  nativeIdentityUnique?: boolean;
  text: string;
  images: string[];
  contexts?: ComposerContext[];
  mentions?: NativeInputMention[];
  /** Exact non-text native references for queued supplements from another client. */
  nativeReferences?: NativeSteerReference[];
}
export interface NativeSteerReceiptPage {
  data: NativeSteerReceipt[];
  nextCursor: string | null;
}
export interface FollowupMessage {
  authority?: "native" | "legacy";
  nativeQueuedSubmissionId?: string;
  nativeClientUserMessageId?: string;
  /** Acceptance metadata only; never evidence that a queued item executed. */
  receiptOnly?: boolean;
  id: string;
  threadId: string;
  text: string;
  images: string[];
  contexts?: ComposerContext[];
  mentions?: NativeInputMention[];
  parameters: Record<string, unknown>;
  mode: FollowupMode;
  expectedTurnId?: string;
  status: FollowupStatus;
  error?: string;
  turnId?: string;
  createdAt: number;
  fingerprint: string;
}
export interface FollowupThread {
  authority?: "native";
  operation?: {
    id: string;
    status: "accepted" | "rejected" | "unknown";
    error?: string;
  };
  undo?: {
    token: string;
    kind: "delete" | "edit";
    before: FollowupMessage;
    after: FollowupMessage;
    index: number;
    expiresAt: number;
  };
  revision: number;
  paused: string | null;
  items: FollowupMessage[];
  replacementId?: string;
  stopTurnId?: string;
  awaitingTurnId?: string;
  review?: {
    turnId: string;
    executionTurnId?: string;
    status: "inProgress" | "completed" | "failed" | "interrupted";
    durationMs?: number | null;
  };
}
export interface FollowupSubmit {
  expectedScope?: string;
  /** Explicit new input after a displayed failure; never resumes older queued work. */
  recoverAfterError?: boolean;
  id: string;
  threadId: string;
  text: string;
  images: string[];
  contexts?: ComposerContext[];
  mentions?: NativeInputMention[];
  parameters: Record<string, unknown>;
  mode: FollowupMode;
  expectedTurnId?: string;
}
export type FollowupAction =
  | { type: "migrate"; id: string; confirmThreadSettings: true }
  | { type: "undo"; token: string; confirmExecution?: true }
  | {
      type: "delete" | "retry" | "steer";
      id: string;
      expectedTurnId?: string;
      confirmUncertain?: boolean;
    }
  | { type: "edit"; id: string; text: string }
  | { type: "reorder"; ids: string[] }
  | { type: "pause" | "resume" | "clear" };
export const emptyFollowupThread = (): FollowupThread => ({
  revision: 0,
  paused: null,
  items: [],
});
