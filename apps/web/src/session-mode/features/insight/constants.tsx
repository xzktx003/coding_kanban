import type { ReactNode } from "react";
import { ClaudeCode, Codex, Gemini } from "@session/components/icons";

export type Range = "day" | "week" | "month" | "year" | "all";
export type AgentKey = "claude" | "codex" | "gemini";

export const RANGES: { label: string; value: Range }[] = [
  { label: "今天", value: "day" },
  { label: "本周", value: "week" },
  { label: "本月", value: "month" },
  { label: "今年", value: "year" },
  { label: "全部", value: "all" },
];

export const AGENT_CONFIG: Record<
  AgentKey,
  { label: string; color: string; icon: ReactNode }
> = {
  claude: { label: "Claude", color: "#a78bfa", icon: <ClaudeCode /> },
  codex: { label: "Codex", color: "#34d399", icon: <Codex /> },
  gemini: { label: "Gemini", color: "#60a5fa", icon: <Gemini /> },
};

export interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}
