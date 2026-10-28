/**
 * The running spinner and message timestamps, aligned with the official
 * Claude Code VS Code extension 2.1.311 (`entry.js:5661`, `chunk_Pb1.js:62`).
 *
 * Reference: docs/designs/claude-render-alignment/message-stream-contract-20261027.md §4, §6
 */

import { useEffect, useRef, useState } from "react";
import {
  shortTimestamp,
  fullTimestamp,
  dateDividerLabel,
  resolveSpinnerVerbs,
  spinnerModeClass,
  statusVerb,
  SPINNER_FRAMES,
  SPINNER_FRAME_MS,
  SPINNER_REDUCED_MOTION_GLYPH,
  type SpinnerVerbSetting,
} from "./stream";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface SpinnerProps {
  /** Replaces the random verb outright, e.g. while compacting. */
  status?: string;
  permissionMode?: string;
  verbSetting?: SpinnerVerbSetting;
  /** Fixes the verb so tests and screenshots stay deterministic. */
  verb?: string;
}

/**
 * Cycles the official 12-frame glyph sequence. Reduced motion pins the glyph
 * rather than stopping at an arbitrary frame.
 */
export function Spinner({
  status,
  permissionMode,
  verbSetting,
  verb,
}: SpinnerProps) {
  const reduced = prefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const verbs = resolveSpinnerVerbs(verbSetting);
  const picked = useRef(
    verb ?? verbs[Math.floor(Math.random() * verbs.length)],
  );

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(
      () => setFrame((current) => (current + 1) % SPINNER_FRAMES.length),
      SPINNER_FRAME_MS,
    );
    return () => clearInterval(timer);
  }, [reduced]);

  const glyph = reduced
    ? SPINNER_REDUCED_MOTION_GLYPH
    : SPINNER_FRAMES[frame];
  const label = statusVerb(status) ?? verb ?? picked.current;

  return (
    <div
      className="claude-spinner-row"
      role="status"
      data-permission-mode={permissionMode}
    >
      <span
        className={`claude-spinner-glyph ${spinnerModeClass(permissionMode)}`}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <span className="claude-spinner-verb">{label}...</span>
    </div>
  );
}

export interface MessageTimestampProps {
  date: Date;
  /** Assistant stamps float top-right; user stamps sit above the bubble. */
  placement?: "response" | "prompt";
  timeZone?: string;
}

/** `jb1` — the short stamp, with the full value on hover. */
export function MessageTimestamp({
  date,
  placement = "response",
  timeZone,
}: MessageTimestampProps) {
  return (
    <div
      className={`claude-message-stamp claude-message-stamp-${placement}`}
      data-message-stamp
    >
      <time dateTime={date.toISOString()} title={fullTimestamp(date, timeZone)}>
        {shortTimestamp(date, timeZone)}
      </time>
    </div>
  );
}

/** `tI1` — the day divider inserted where the local calendar day changes. */
export function DateDivider({
  date,
  now,
  timeZone,
}: {
  date: Date;
  now?: Date;
  timeZone?: string;
}) {
  return (
    <div className="claude-date-divider" role="separator">
      <span className="claude-date-divider-wave" aria-hidden="true" />
      <span className="claude-date-divider-label">
        {dateDividerLabel(date, now ?? new Date(), timeZone)}
      </span>
      <span className="claude-date-divider-wave" aria-hidden="true" />
    </div>
  );
}
