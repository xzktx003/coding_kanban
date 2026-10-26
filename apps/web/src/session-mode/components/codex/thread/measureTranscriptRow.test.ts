import { describe, expect, it, vi } from "vitest";
import {
  measureTranscriptRow,
  shouldAdjustTranscriptRow,
} from "./measureTranscriptRow";

function row(height: number) {
  return {
    getBoundingClientRect: vi.fn(() => ({ height })),
  } as unknown as HTMLElement;
}
describe("transcript row first-paint measurement", () => {
  it("uses the actual new short or long row before its first observer delivery", () => {
    expect(measureTranscriptRow(row(120.25), undefined, 160)).toBe(120.25);
    expect(measureTranscriptRow(row(1388.75), undefined, 160)).toBe(1388.75);
  });
  it("keeps observer measurement synchronous without requesting another layout", () => {
    const element = row(160);
    const entry = {
      borderBoxSize: [{ blockSize: 640.5 }],
    } as unknown as ResizeObserverEntry;
    expect(measureTranscriptRow(element, entry, 160)).toBe(640.5);
    expect(element.getBoundingClientRect).not.toHaveBeenCalled();
  });
  it("retains a valid cached size while hidden or receiving a zero observer box", () => {
    const element = row(0);
    expect(measureTranscriptRow(element, undefined, 412)).toBe(412);
    expect(measureTranscriptRow(row(0), undefined)).toBe(160);
    const entry = {
      borderBoxSize: [{ blockSize: 0 }],
    } as unknown as ResizeObserverEntry;
    expect(measureTranscriptRow(element, entry, 412)).toBe(412);
    expect(element.getBoundingClientRect).toHaveBeenCalledTimes(1);
  });
});

describe("transcript row scroll compensation", () => {
  it("preserves a reader when a newly mounted short row replaces an overlapping estimate", () => {
    // The native scroll reaches 500; a new 280px estimate ends at 560,
    // while its first real 99px box ends at 379, entirely above the reader.
    expect(shouldAdjustTranscriptRow(560, -181, 500, true)).toBe(true);
  });
  it("does not move the reader for a newly mounted row whose real box intersects the viewport", () => {
    expect(shouldAdjustTranscriptRow(560, -20, 500, true)).toBe(false);
    expect(shouldAdjustTranscriptRow(480, 181, 500, true)).toBe(false);
  });
  it("keeps the top of an already visible partial row fixed when its content grows or shrinks", () => {
    expect(shouldAdjustTranscriptRow(560, -181, 500, false)).toBe(false);
    expect(shouldAdjustTranscriptRow(560, 181, 500, false)).toBe(false);
  });
  it("compensates an existing row that was entirely above the reader before resizing", () => {
    expect(shouldAdjustTranscriptRow(480, -181, 500, false)).toBe(true);
    expect(shouldAdjustTranscriptRow(480, 181, 500, false)).toBe(true);
    expect(shouldAdjustTranscriptRow(500, 181, 500, false)).toBe(true);
  });
});
