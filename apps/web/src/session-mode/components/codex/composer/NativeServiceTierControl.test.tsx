import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import type { Model } from "@session/bindings/v2";
import { NativeServiceTierControl } from "./NativeServiceTierControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
const calls = vi.hoisted(() => ({
  set: vi.fn(),
  owner: vi.fn(),
  tier: null as string | null,
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: (owner: string) => {
    calls.owner(owner);
    return { serviceTier: calls.tier, setServiceTier: calls.set };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  calls.tier = null;
});
it.each(["fast", "priority"])(
  "directly enables the catalog tier %s for the captured owner",
  async (tierId) => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>模型</DropdownMenuTrigger>
        <DropdownMenuContent>
          <NativeServiceTierControl
            model={
              {
                serviceTiers: [
                  { id: "standard", name: "标准模式", description: "默认速度" },
                  { id: tierId, name: "Fast", description: "使用更多额度" },
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
    expect(calls.set).toHaveBeenCalledWith(tierId);
    expect(screen.queryByText("标准模式")).toBeNull();
    expect(
      screen.getByRole("menuitemcheckbox").getAttribute("aria-haspopup"),
    ).toBeNull();
  },
);

it.each(["fast", "priority"])(
  "a lit %s bolt directly switches back to the default tier",
  async (tierId) => {
    calls.tier = tierId;
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>模型</DropdownMenuTrigger>
        <DropdownMenuContent>
          <NativeServiceTierControl
            model={
              {
                serviceTiers: [
                  { id: "standard", name: "标准模式", description: "默认速度" },
                  { id: tierId, name: "Fast", description: "使用更多额度" },
                ],
              } as Model
            }
            threadId="current-owner"
          />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const bolt = await screen.findByRole("menuitemcheckbox", {
      name: "启用标准模式",
    });
    expect(bolt.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(bolt, { key: "Enter" });
    expect(calls.owner).toHaveBeenCalledWith("current-owner");
    expect(calls.set).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.queryByText("Fast")).toBeNull();
  },
);

it("a model without tier capabilities has no acceleration control", () => {
  const { container } = render(
    <NativeServiceTierControl
      model={{ serviceTiers: [] } as unknown as Model}
      threadId="unsupported-owner"
    />,
  );
  expect(container.innerHTML).toBe("");
  expect(calls.set).not.toHaveBeenCalled();
});
