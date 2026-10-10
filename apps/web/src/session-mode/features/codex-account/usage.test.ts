import { describe, expect, it } from "vitest";
import type {
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
} from "@session/bindings/v2";
import { nativeUsageGroups, nativeUsageWindow } from "./usage";
const bucket = (patch: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot => ({
  limitId: "codex",
  limitName: "Codex",
  primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 100 },
  secondary: null,
  credits: null,
  individualLimit: null,
  spendControlReached: null,
  planType: null,
  rateLimitReachedType: null,
  ...patch,
});
const response = (
  map: GetAccountRateLimitsResponse["rateLimitsByLimitId"],
): GetAccountRateLimitsResponse => ({
  rateLimits: bucket(),
  rateLimitsByLimitId: map,
  rateLimitResetCredits: null,
});
describe("native account usage", () => {
  it("prefers authoritative multiple buckets including empty map, retaining ids and actual remaining percent", () => {
    const groups = nativeUsageGroups(
      response({
        codex: bucket(),
        gpt_special: bucket({
          limitId: "gpt_special",
          limitName: "gpt_special",
          primary: { usedPercent: 99, windowDurationMins: 120, resetsAt: null },
        }),
      }),
    );
    expect(
      groups.map((group) => [
        group.id,
        group.label,
        group.windows[0]?.remainingPercent,
      ]),
    ).toEqual([
      ["codex", "Codex", 77],
      ["gpt_special", "gpt-special", 1],
    ]);
    expect(nativeUsageGroups(response({}))).toEqual([]);
    expect(nativeUsageGroups(response(null))).toHaveLength(1);
  });
  it("unknown data remains unavailable rather than becoming unused quota, finite values clamp", () => {
    expect(nativeUsageGroups(null)).toEqual([]);
    expect(
      nativeUsageGroups(
        response({
          codex: bucket({
            primary: {
              usedPercent: NaN,
              windowDurationMins: null,
              resetsAt: null,
            },
          }),
        }),
      )[0].windows[0].remainingPercent,
    ).toBeNull();
    expect(
      nativeUsageGroups(
        response({
          codex: bucket({
            primary: {
              usedPercent: 120,
              windowDurationMins: 300,
              resetsAt: null,
            },
            secondary: {
              usedPercent: -5,
              windowDurationMins: 60,
              resetsAt: null,
            },
          }),
        }),
      )[0].windows.map((window) => window.remainingPercent),
    ).toEqual([0, 100]);
  });
  it("window labels use actual native durations and five percent month/year/5h rounding", () => {
    expect(
      [null, 45, 120, 299, 1440, 10080, 43201, 525600].map(nativeUsageWindow),
    ).toEqual([
      { unit: "unknown", count: null },
      { unit: "minutes", count: 45 },
      { unit: "hours", count: 2 },
      { unit: "hours", count: 5 },
      { unit: "days", count: 1 },
      { unit: "days", count: 7 },
      { unit: "months", count: 1 },
      { unit: "years", count: 1 },
    ]);
  });
});
