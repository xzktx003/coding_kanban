import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AutoMationsView } from "./AutoMationsView";
const io = vi.hoisted(() => ({ list: vi.fn(), select: vi.fn() }));
vi.mock("@session/services/apiAdapt", () => ({
  listAutomations: io.list,
  setAutomationPaused: vi.fn(),
}));
vi.mock("@session/stores", () => ({
  useLayoutStore: () => ({
    selectedAutomationTaskId: null,
    setSelectedAutomationTaskId: io.select,
  }),
}));
vi.mock("./useAutomationRuns", () => ({
  useAutomationRuns: () => ({ getRunsForTask: () => [] }),
}));
vi.mock("./useBotNames", () => ({ useBotNames: () => ({}) }));
vi.mock("./ManageDialog", () => ({ ManageDialog: () => null }));
vi.mock("./TaskDetailPanel", () => ({ TaskDetailPanel: () => null }));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));
test("failed automation load is distinct from an empty list and can retry", async () => {
  io.list
    .mockRejectedValueOnce(new Error("fixture unavailable"))
    .mockResolvedValueOnce([]);
  render(<AutoMationsView />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "fixture unavailable",
  );
  expect(screen.queryByText(/No automations yet|暂无定时任务/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(io.list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(io.select).not.toHaveBeenCalled();
});
