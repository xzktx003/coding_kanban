import { describe, expect, it } from "vitest";
import { planWarmTranscriptRetention } from "./sessionWarmRetention";

const MB = 1024 * 1024;
const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  bytes: MB,
  lastUsed: 0,
  visible: false,
  expired: true,
  blocked: false,
  dormant: false,
  reclaimedAt: 0,
  ...overrides,
});

describe("recent-page warm retention inside the existing display budget", () => {
  it("keeps all small followed recent pages warm after the old sixty-second grace", () => {
    expect(
      planWarmTranscriptRetention(
        Array.from({ length: 30 }, (_, i) =>
          entry(String(i), { bytes: 16 * 1024 }),
        ),
        { now: 120_000 },
      ),
    ).toEqual({
      evict: [],
      warm: [],
    });
  });

  it("reclaims the least recently used invisible bodies while protecting visible consumers", () => {
    const plan = planWarmTranscriptRetention(
      [
        entry("visible", { bytes: 10 * MB, visible: true }),
        entry("newest", { bytes: 4 * MB, lastUsed: 5 }),
        entry("oldest", { bytes: 4 * MB, lastUsed: 1 }),
        entry("middle", { bytes: 4 * MB, lastUsed: 3 }),
      ],
      { now: 120_000 },
    );
    expect(plan.evict).toEqual(["oldest", "middle"]);
    expect(plan.warm).toEqual([]);
  });

  it("keeps reconciliation and the initial departure grace protected under pressure", () => {
    expect(
      planWarmTranscriptRetention(
        [
          entry("reading", { visible: true }),
          entry("uncertain", { blocked: true }),
          entry("grace", { expired: false }),
          entry("reclaim"),
        ],
        { now: 120_000, pressure: true },
      ).evict,
    ).toEqual(["reclaim"]);
  });

  it("only restores reclaimed recent pages after cooldown and below the low water mark", () => {
    const candidates = [
      entry("recently-reclaimed", {
        dormant: true,
        bytes: 0,
        reclaimedAt: 100_000,
      }),
      entry("reclaimable", {
        dormant: true,
        bytes: 0,
        reclaimedAt: 1,
        lastBytes: MB,
      }),
    ];
    expect(
      planWarmTranscriptRetention(candidates, { now: 120_000 }).warm,
    ).toEqual(["reclaimable"]);
    expect(
      planWarmTranscriptRetention(
        [entry("occupied", { bytes: 12 * MB }), ...candidates],
        { now: 120_000 },
      ).warm,
    ).toEqual([]);
    expect(
      planWarmTranscriptRetention(candidates, { now: 120_000, pressure: true })
        .warm,
    ).toEqual([]);
  });

  it("supports the original sixty-second policy without background rewarming", () => {
    expect(
      planWarmTranscriptRetention(
        [
          entry("expired-small", { bytes: 16 * 1024 }),
          entry("visible", { visible: true }),
          entry("awaiting-receipt", { blocked: true }),
          entry("within-grace", { expired: false }),
          entry("already-dormant", { dormant: true, bytes: 0 }),
        ],
        { now: 120_000, warm: false },
      ),
    ).toEqual({ evict: ["expired-small"], warm: [] });
  });
});
