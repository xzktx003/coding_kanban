import type { ReasoningEffort } from "@session/bindings";

export interface RecentModelConfig {
  model: string;
  label: string;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: string | null;
}

const recent: RecentModelConfig[] = [];

function key(item: RecentModelConfig) {
  return `${item.model}|${item.reasoningEffort ?? ""}|${item.serviceTier ?? ""}`;
}

export function rememberRecentModel(item: RecentModelConfig) {
  if (!item.model) return;
  const next = [item, ...recent.filter((saved) => key(saved) !== key(item))];
  recent.splice(0, recent.length, ...next.slice(0, 8));
}

export function recentModelConfigs() {
  return [...recent];
}

export function resetRecentModels() {
  recent.length = 0;
}
