import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { UserInfo } from "@session/components/layout/UserInfo";
import { useCodexStore } from "@session/components/codex/stores";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
const { snapshots, changeAccount } = vi.hoisted(() => ({
  snapshots: vi.fn().mockResolvedValue([]),
  changeAccount: vi.fn(),
}));
vi.mock("@session/services", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  listAccountSnapshots: snapshots,
  switchAccountSnapshot: changeAccount,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@session/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <>{children}</>,
}));
vi.mock("@session/components/codex/CodexAuthDialog", () => ({
  CodexAuthDialog: ({ open }: any) =>
    open ? <div role="dialog">Auth dialog</div> : null,
}));
vi.mock("./NativeAccountUsageDialog", () => ({
  NativeAccountUsageDialog: ({ open }: any) =>
    open ? <div role="dialog">Readonly native quota</div> : null,
}));
beforeEach(() => {
  useCodexStore.setState({
    hasAccount: true,
    account: {
      type: "chatgpt",
      email: "fixture@example.invalid",
      planType: "plus",
    },
  });
  useWorkspaceStore.setState({ projects: [] });
  changeAccount.mockClear();
});
it("account menu provides an explicit quota dialog entry without creating a window or switching accounts", () => {
  const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
  render(<UserInfo />);
  fireEvent.click(screen.getByRole("button", { name: /^usage$/ }));
  expect(screen.getByRole("dialog").textContent).toContain(
    "Readonly native quota",
  );
  expect(changeAccount).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
});
