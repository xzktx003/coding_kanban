import type {
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
} from "@session/bindings/v2";
export interface NativeUsageWindow {
  key: "primary" | "secondary";
  remainingPercent: number | null;
  minutes: number | null;
  resetsAt: number | null;
}
export interface NativeUsageGroup {
  id: string;
  label: string;
  windows: NativeUsageWindow[];
}
/** Actual extension statusPlain jya/Mya/Nya: 5h and month/year windows use a
 * five-percent tolerance; other durations keep their native minute/hour/day unit.
 */
export function nativeUsageWindow(minutes: number | null): {
  unit: "unknown" | "minutes" | "hours" | "days" | "months" | "years";
  count: number | null;
} {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0)
    return { unit: "unknown", count: null };
  const near = (expected: number) =>
    minutes >= expected * 0.95 && minutes <= expected * 1.05;
  if (near(300)) return { unit: "hours", count: 5 };
  for (const [unit, duration] of [
    ["years", 365 * 1440],
    ["months", 30 * 1440],
  ] as const) {
    const count = Math.max(1, Math.round(minutes / duration));
    if (near(count * duration)) return { unit, count };
  }
  if (minutes % 1440 === 0) return { unit: "days", count: minutes / 1440 };
  if (minutes % 60 === 0) return { unit: "hours", count: minutes / 60 };
  return { unit: "minutes", count: minutes };
}
export function nativeUsageGroups(
  response: GetAccountRateLimitsResponse | null,
): NativeUsageGroup[] {
  if (!response) return [];
  const map = response.rateLimitsByLimitId;
  const entries: Array<[string, RateLimitSnapshot | undefined]> =
    map !== null && map !== undefined
      ? Object.entries(map)
      : [[response.rateLimits?.limitId ?? "codex", response.rateLimits]];
  return entries
    .filter((entry): entry is [string, RateLimitSnapshot] => Boolean(entry[1]))
    .map(([id, bucket]) => ({
      id,
      label: (bucket.limitName ?? bucket.limitId ?? id).replace(/_/g, "-"),
      windows: (["primary", "secondary"] as const).flatMap((key) => {
        const value = bucket[key];
        if (!value) return [];
        return [
          {
            key,
            remainingPercent:
              typeof value.usedPercent === "number" &&
              Number.isFinite(value.usedPercent)
                ? Math.max(0, Math.min(100, 100 - value.usedPercent))
                : null,
            minutes: value.windowDurationMins ?? null,
            resetsAt: value.resetsAt ?? null,
          },
        ];
      }),
    }));
}
