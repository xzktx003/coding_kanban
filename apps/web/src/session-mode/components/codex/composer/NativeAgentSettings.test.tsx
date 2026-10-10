import { fireEvent, render, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { NativeAgentSettings } from "./NativeAgentSettings";
const choose = vi.hoisted(() => vi.fn());
vi.mock("@session/services/builtinInputNavigation", () => ({
  selectBuiltinInputTarget: choose,
}));
vi.mock("@session/components/agent/AgentModelPanel", () => ({
  AgentModelPanel: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));
it("keeps a direct Agent switch visible while advanced provider configuration stays separate", () => {
  render(
    <NativeAgentSettings>
      <p>高级提供商配置</p>
    </NativeAgentSettings>,
  );
  fireEvent.click(screen.getByRole("button", { name: "切换到 Claude Code" }));
  expect(choose).toHaveBeenCalledWith("cc");
  expect(
    screen.getByRole("button", { name: "当前 Agent：Codex" }),
  ).toBeDefined();
});
