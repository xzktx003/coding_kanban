import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SideBarPinnedList } from "./SideBarPinnedList";
import { usePinStore } from "@session/stores/usePinStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAcpStore } from "@session/stores/useAcpStore";
const io = vi.hoisted(() => ({ select: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@session/services/codexService", () => ({
  codexService: { setCurrentThread: io.select },
}));
vi.mock("@session/hooks/useCCSessionManager", () => ({
  useCCSessionManager: () => ({ handleSessionSelect: vi.fn() }),
}));
vi.mock("../common/SessionStatus", () => ({ UnreadDot: () => null }));
test("pinned rows open on own keyboard activation and child keys never open another target", async () => {
  usePinStore.setState({
    pinned: [
      {
        kind: "codex",
        id: "pinned-target",
        title: "固定会话",
        cwd: "/fixture",
      },
    ],
  });
  useLayoutStore.setState({ isPinnedListOpen: true });
  useAcpStore.setState({ active: true });
  render(<SideBarPinnedList />);
  const row = screen.getByText("固定会话").closest("[role=button]")!;
  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() =>
    expect(io.select).toHaveBeenCalledExactlyOnceWith("pinned-target"),
  );
  expect(useAcpStore.getState().active).toBe(false);
  const unpin = screen.getByRole("button", { name: "取消置顶固定会话" });
  fireEvent.keyDown(unpin, { key: " " });
  expect(io.select).toHaveBeenCalledTimes(1);
  fireEvent.click(unpin);
  expect(usePinStore.getState().pinned).toEqual([]);
});
