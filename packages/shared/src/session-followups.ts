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
  revision: number;
  paused: string | null;
  items: FollowupMessage[];
  replacementId?: string;
  stopTurnId?: string;
}
export interface FollowupSubmit {
  id: string;
  threadId: string;
  text: string;
  images: string[];
  parameters: Record<string, unknown>;
  mode: FollowupMode;
  expectedTurnId?: string;
}
export type FollowupAction =
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
