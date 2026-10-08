import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AgentModelTrigger } from "./AgentModelTrigger";
import { useConfigStore } from "../codex/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAcpStore } from "@session/stores/useAcpStore";
afterEach(cleanup);
it("keeps the chosen reasoning effort visible inside the compact model control", () => {
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useConfigStore.setState({ model: "gpt-6-astra", reasoningEffort: "high" });
  render(<AgentModelTrigger compact />);
  expect(screen.getByText("High")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /Codex，gpt-6-astra，high/ }),
  ).toBeTruthy();
});
it("shows an explicit None when reasoning is disabled", () => {
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useAcpStore.setState({ active: false });
  useConfigStore.setState({ model: "gpt-6-astra", reasoningEffort: "none" });
  render(<AgentModelTrigger compact />);
  expect(screen.getByText("None")).toBeTruthy();
});
