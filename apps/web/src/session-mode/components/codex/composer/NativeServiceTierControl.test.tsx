import { fireEvent, render, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import type { Model } from "@session/bindings/v2";
import { NativeServiceTierControl } from "./NativeServiceTierControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
const calls = vi.hoisted(() => ({ set: vi.fn(), owner: vi.fn() }));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: (owner: string) => {
    calls.owner(owner);
    return { serviceTier: null, setServiceTier: calls.set };
  },
}));
it("exposes Fast only for a real model capability and updates the captured owner", async () => {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>模型</DropdownMenuTrigger>
      <DropdownMenuContent>
        <NativeServiceTierControl
          model={
            {
              serviceTiers: [
                { id: "fast", name: "快速", description: "使用更多额度" },
              ],
            } as Model
          }
          threadId="original-owner"
        />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "启用快速模式" }),
  );
  expect(calls.owner).toHaveBeenCalledWith("original-owner");
  expect(calls.set).toHaveBeenCalledWith("fast");
});
