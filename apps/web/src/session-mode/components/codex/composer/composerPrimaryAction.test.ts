import { expect, it } from "vitest";
import {
  composerPrimaryAction,
  hasPendingComposerInput,
} from "./composerPrimaryAction";
const base = {
  dictation: "idle" as const,
  running: false,
  hasContent: false,
  resumeAvailable: false,
  mode: "queue" as const,
};
it("gives dictation finish priority over task stop and never exposes a second primary action", () => {
  expect(
    composerPrimaryAction({ ...base, running: true, dictation: "recording" }),
  ).toBe("dictation-finish");
  expect(
    composerPrimaryAction({
      ...base,
      running: true,
      dictation: "transcribing",
    }),
  ).toBe("dictation-wait");
  expect(composerPrimaryAction({ ...base, running: true })).toBe("stop");
});
it("resumes only idle empty eligible threads and keeps explicit queue/steer semantics", () => {
  expect(composerPrimaryAction({ ...base, resumeAvailable: true })).toBe(
    "resume",
  );
  expect(
    composerPrimaryAction({ ...base, resumeAvailable: true, hasContent: true }),
  ).toBe("send");
  expect(
    composerPrimaryAction({ ...base, running: true, hasContent: true }),
  ).toBe("queue");
  expect(
    composerPrimaryAction({
      ...base,
      running: true,
      hasContent: true,
      mode: "steer",
    }),
  ).toBe("steer");
});
it("settled queue receipts do not hide Resume, but unsent or unknown input does", () => {
  expect(
    hasPendingComposerInput([{ status: "sent" }, { status: "cancelled" }]),
  ).toBe(false);
  for (const status of ["queued", "sending", "uncertain", "failed"])
    expect(hasPendingComposerInput([{ status }])).toBe(true);
});
it("routes an active realtime connection to voice text/end actions, ahead of ordinary Stop or Resume", () => {
  expect(composerPrimaryAction({ ...base, realtime: "active", running: true })).toBe("voice-end");
  expect(composerPrimaryAction({ ...base, realtime: "active", hasContent: true, running: true })).toBe("voice-send");
  expect(composerPrimaryAction({ ...base, realtime: "starting", resumeAvailable: true })).toBe("voice-wait");
  expect(composerPrimaryAction({ ...base, realtime: "stopping", resumeAvailable: true })).toBe("voice-wait");
});
