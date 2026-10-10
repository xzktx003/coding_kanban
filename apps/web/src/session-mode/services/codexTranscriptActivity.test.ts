import { afterEach, expect, it, vi } from "vitest";
import {
  retainCodexTranscript,
  trackCodexTranscript,
  expiredCodexTranscripts,
  markCodexTranscriptDormant,
  isCodexTranscriptDormant,
  needsCodexTranscriptRestore,
  acknowledgeCodexTranscriptRestore,
  forgetCodexTranscript,
} from "./codexTranscriptActivity";

afterEach(() => {
  vi.useRealTimers();
  forgetCodexTranscript("lifecycle");
});

it("expires after the last visible consumer leaves for 60 seconds, cancelling expiry on reuse", () => {
  vi.useFakeTimers();
  trackCodexTranscript("lifecycle");
  const first = retainCodexTranscript("lifecycle");
  const second = retainCodexTranscript("lifecycle");
  first();
  first();
  vi.advanceTimersByTime(61_000);
  expect(expiredCodexTranscripts()).not.toContain("lifecycle");
  second();
  vi.advanceTimersByTime(59_999);
  expect(expiredCodexTranscripts()).not.toContain("lifecycle");
  const returned = retainCodexTranscript("lifecycle");
  returned();
  vi.advanceTimersByTime(60_000);
  expect(expiredCodexTranscripts()).toContain("lifecycle");
});

it("keeps the restore marker through activation and failed or hidden reads", () => {
  trackCodexTranscript("lifecycle");
  markCodexTranscriptDormant("lifecycle");
  expect(isCodexTranscriptDormant("lifecycle")).toBe(true);
  acknowledgeCodexTranscriptRestore("lifecycle");
  expect(needsCodexTranscriptRestore("lifecycle")).toBe(true);
  const release = retainCodexTranscript("lifecycle");
  expect(isCodexTranscriptDormant("lifecycle")).toBe(false);
  expect(needsCodexTranscriptRestore("lifecycle")).toBe(true);
  acknowledgeCodexTranscriptRestore("lifecycle");
  expect(needsCodexTranscriptRestore("lifecycle")).toBe(false);
  release();
});

it("can expire again after a failed restore and another visible lifetime", () => {
  vi.useFakeTimers();
  trackCodexTranscript("lifecycle");
  markCodexTranscriptDormant("lifecycle");
  const release = retainCodexTranscript("lifecycle");
  // History failed, but live messages may have allocated a new body.
  release();
  expect(needsCodexTranscriptRestore("lifecycle")).toBe(true);
  expect(isCodexTranscriptDormant("lifecycle")).toBe(false);
  vi.advanceTimersByTime(60_000);
  expect(expiredCodexTranscripts()).toContain("lifecycle");
});
