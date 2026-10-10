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
export interface FollowupMessage {
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
  | { type: "undo"; token: string }
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
