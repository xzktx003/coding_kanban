import type { ModelServiceTier } from "@session/bindings/v2/ModelServiceTier";

const LABELS: Record<string, string> = {
  fast: "快速",
  priority: "快速",
  ultra: "超快",
  "ultra-fast": "超快",
};

/** Plugin cycle is 标准、快速、超快. Only advertised catalog tiers are included. */
export function cycleServiceTier(
  tiers: ModelServiceTier[],
  current: string | null,
) {
  const speeds = [
    tiers.find((tier) => tier.id === "priority") ??
      tiers.find((tier) => tier.id === "fast"),
    tiers.find((tier) => tier.id === "ultra") ??
      tiers.find((tier) => tier.id === "ultra-fast"),
  ].filter((tier): tier is ModelServiceTier => Boolean(tier));
  if (!speeds.length) return null;
  const index = speeds.findIndex((tier) => tier.id === current);
  const next = speeds[(index + 1) % speeds.length];
  return {
    id: index === speeds.length - 1 ? null : next.id,
    label: index === speeds.length - 1 ? "标准" : (LABELS[next.id] ?? next.name),
  };
}
