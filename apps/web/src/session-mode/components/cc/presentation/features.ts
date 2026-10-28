/**
 * The remaining official capabilities: focus view, reopening a closed
 * session, archiving inactive ones, and the compaction notice.
 *
 * Aligned with Claude Code VS Code 2.1.311. Pure logic so each rule is
 * directly assertable; the components consume these.
 *
 * Reference: docs/designs/claude-render-alignment/plan-20261027.md §5
 */

// --------------------------------------------------------------- focus view

/**
 * `claudeCode.focusView` / `claude-vscode.toggleFocusView` (ctrl+alt+f).
 * Focus view hides the surrounding chrome so only the conversation shows.
 */
export function focusViewClass(active: boolean): string {
  return active ? "claude-focus-view" : "";
}

/** The command's title, used for the toggle's accessible name. */
export const FOCUS_VIEW_LABEL = "Toggle Focus view";

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/** `ctrl+alt+f`, matching the official keybinding. */
export function isFocusViewShortcut(event: Shortcut): boolean {
  return (
    event.key.toLowerCase() === "f" &&
    !!event.ctrl &&
    !!event.alt &&
    !event.shift
  );
}

/** `cmd+shift+t` — reopen the most recently closed session. */
export function isReopenShortcut(event: Shortcut): boolean {
  return (
    event.key.toLowerCase() === "t" &&
    !!event.shift &&
    (!!event.ctrl || !!event.meta)
  );
}

/** `cmd+n` — start a new conversation. */
export function isNewConversationShortcut(event: Shortcut): boolean {
  return (
    event.key.toLowerCase() === "n" &&
    (!!event.ctrl || !!event.meta) &&
    !event.shift
  );
}

// ------------------------------------------------------- closed-session ring

/**
 * Tracks recently closed sessions so `Reopen Closed Session` can restore
 * them. Closing a tab in this product only unfollows the session, so this is
 * a reopen hint rather than a resurrection: the conversation still exists.
 */
export class ClosedSessionRing {
  private readonly ids: string[] = [];
  constructor(private readonly limit = 10) {}

  /** Records a close. A re-closed session moves to the front, not duplicated. */
  push(sessionId: string) {
    const existing = this.ids.indexOf(sessionId);
    if (existing !== -1) this.ids.splice(existing, 1);
    this.ids.unshift(sessionId);
    if (this.ids.length > this.limit) this.ids.length = this.limit;
  }

  /** Removes and returns the most recently closed session. */
  pop(): string | undefined {
    return this.ids.shift();
  }

  /** Drops a session, e.g. once it is reopened by other means. */
  forget(sessionId: string) {
    const at = this.ids.indexOf(sessionId);
    if (at !== -1) this.ids.splice(at, 1);
  }

  get size() {
    return this.ids.length;
  }

  peek(): string | undefined {
    return this.ids[0];
  }
}

// ------------------------------------------------------------------ archive

export interface ArchivableSession {
  id: string;
  /** Epoch millis of the last activity. */
  updatedAt: number;
  /** A running session is never archived, however old it looks. */
  running?: boolean;
  archived?: boolean;
}

/** Officially `claudeCode.archiveInactiveSessions`; default off. */
export const DEFAULT_ARCHIVE_AFTER_DAYS = 30;

/**
 * Picks the sessions eligible for archiving. Archiving is a stronger state
 * than this product's tab close (which only unfollows), so running sessions
 * and already-archived ones are excluded and the caller must apply it
 * explicitly.
 */
export function archivableSessions(
  sessions: readonly ArchivableSession[],
  now: number,
  afterDays: number = DEFAULT_ARCHIVE_AFTER_DAYS,
): string[] {
  if (!Number.isFinite(afterDays) || afterDays <= 0) return [];
  const cutoff = now - afterDays * 24 * 60 * 60 * 1000;
  return sessions
    .filter(
      (session) =>
        !session.archived && !session.running && session.updatedAt < cutoff,
    )
    .map((session) => session.id);
}

// --------------------------------------------------------------- compaction

export interface CompactionNotice {
  trigger: "manual" | "auto";
  tokensFreed: number;
  summary?: string;
}

export const COMPACTION_FALLBACK =
  "Conversation was compacted to free up context.";

/** `wb0` — the collapsible notice's summary line and body. */
export function compactionNotice({
  trigger,
  tokensFreed,
  summary,
}: CompactionNotice): { title: string; body: string } {
  return {
    title: `Compacted chat · ${trigger} · ${Math.round(tokensFreed / 1000)}k tokens freed`,
    body: summary?.trim() ? summary.trim() : COMPACTION_FALLBACK,
  };
}

// ------------------------------------------------------------------ rating

export type Rating = "positive" | "negative";

export const RATING_LABELS: Record<Rating, string> = {
  positive: "Good response",
  negative: "Bad response",
};

export const RATING_NOTICE_PROMPT = "Learn how we use your feedback";
export const RATING_NOTICE_THANKS =
  "Thanks for your feedback · Learn how we use it";

/**
 * Clicking the active rating clears it, as the official control does, so the
 * next state is a toggle rather than a set.
 */
export function nextRating(
  current: Rating | undefined,
  clicked: Rating,
): Rating | undefined {
  return current === clicked ? undefined : clicked;
}

/**
 * The official control is experiment-gated and also respects the analytics
 * and product-feedback opt-outs; all three must allow it.
 */
export function showsRating(flags: {
  experimentEnabled?: boolean;
  analyticsDisabled?: boolean;
  productFeedbackDisabled?: boolean;
}): boolean {
  return (
    !!flags.experimentEnabled &&
    !flags.analyticsDisabled &&
    !flags.productFeedbackDisabled
  );
}
