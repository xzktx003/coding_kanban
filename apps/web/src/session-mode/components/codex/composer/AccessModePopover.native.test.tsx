import { fireEvent, render, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { AccessModePopover } from "./AccessModePopover";
const native = vi.hoisted(() => ({
  access: vi.fn(),
  reviewer: vi.fn(),
  mode: "plan",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: (selector: (state: unknown) => unknown) =>
    selector({ currentThreadId: "owner", triggerInputFocus: vi.fn() }),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    sandbox: "workspace-write",
    collaborationMode: native.mode,
    approvalsReviewer: "user",
    autoReviewCapability: null,
    setAccessMode: native.access,
    setApprovalsReviewer: native.reviewer,
    setCollaborationMode: vi.fn(),
  }),
}));
it("keeps the active native planning mode visible in the compact permission trigger", () => {
  render(<AccessModePopover compact />);
  expect(screen.getByRole("button", { name: "执行权限：plan" })).toBeDefined();
});
it("uses real default permissions and does not enable native auto approval without an authoritative capability", async () => {
  native.mode = "default";
  render(<AccessModePopover compact />);
  fireEvent.keyDown(screen.getByRole("button", { name: /执行权限/ }), {
    key: "ArrowDown",
  });
  expect(
    (
      await screen.findByRole("menuitemradio", { name: /帮我批准/ })
    ).getAttribute("data-disabled"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("menuitemradio", { name: /请求批准/ }));
  expect(native.access).toHaveBeenCalledWith("workspace-write");
  expect(native.reviewer).toHaveBeenCalledWith("user");
});
