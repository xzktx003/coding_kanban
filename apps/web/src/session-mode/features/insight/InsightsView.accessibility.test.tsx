import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import InsightsView from "./InsightsView";
vi.mock("@session/services/apiAdapt/insights", () => ({
  getInsightFilterOptions: async () => ({ cwds: [], session_ids: [] }),
  getAgentHeatmaps: async () => ({ codex: {}, claude: null, gemini: null }),
  getInsightRankings: async () => ({ by_cwd: [], by_session: [] }),
}));
vi.mock("./OverviewTab", () => ({ OverviewTab: () => null }));
vi.mock("./RankingsTab", () => ({ RankingsTab: () => null }));
vi.mock("./AgentPanel", () => ({ AgentPanel: () => null }));
test("agent usage tabs have names beyond their icons", async () => {
  render(<InsightsView />);
  const tab = await screen.findByRole("tab", { name: "Codex 用量" });
  expect(tab.getAttribute("title")).toBe("Codex 用量");
});
