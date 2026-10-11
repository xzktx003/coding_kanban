import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { NativeAgentSettings } from "./NativeAgentSettings";

it("keeps Codex model settings without a Claude switch in the composer", () => {
  render(
    <NativeAgentSettings>
      <p>提供商模型列表</p>
    </NativeAgentSettings>,
  );
  expect(screen.queryByRole("button", { name: "切换到 Claude Code" })).toBeNull();
  expect(screen.getByText("提供商模型列表")).toBeDefined();
});
