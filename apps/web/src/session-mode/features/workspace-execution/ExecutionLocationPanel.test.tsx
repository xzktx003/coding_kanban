import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  branches: vi.fn(),
  context: vi.fn(),
  threads: vi.fn(),
  metadata: vi.fn(),
}));
vi.mock("./api", () => ({
  listLocalEnvironments: api.list,
  saveLocalEnvironments: api.save,
  readLocalEnvironmentReceipt: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/git", () => ({
  gitListBranches: api.branches,
  gitInspectWorktree: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  listThreads: api.threads,
  threadMetadata: api.metadata,
}));
vi.mock("@session/services/nativeOperationContext", () => ({
  readNativeOperationContext: api.context,
}));
import { ExecutionLocationPanel } from "./ExecutionLocationPanel";
import { resetGoalCompletionScope } from "@session/services/goalCompletionAutoClear";
const environments = {
  root: "/project",
  version: "a".repeat(64),
  environments: [],
};
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  api.list.mockResolvedValue(environments);
  api.save.mockResolvedValue(environments);
  api.branches.mockResolvedValue({ branches: [] });
  api.context.mockResolvedValue({
    namespace: "fixture-native",
    scopeToken: "b".repeat(64),
  });
});
afterEach(cleanup);
it("revokes an open workspace panel on a same-value account event and blocks its stale save", async () => {
  const close = vi.fn();
  render(
    <ExecutionLocationPanel
      root="/project"
      owner="codex:one"
      onClose={close}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "配置项目设置命令" }),
  );
  await waitFor(() => expect(api.list).toHaveBeenCalledOnce());
  act(() => resetGoalCompletionScope());
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "保存环境配置" }));
  await act(async () => {});
  expect(api.save).not.toHaveBeenCalled();
});
it("does not publish a late configuration read after scope revocation", async () => {
  let resolve!: (value: typeof environments) => void;
  api.list.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const close = vi.fn();
  render(
    <ExecutionLocationPanel
      root="/project"
      owner="codex:one"
      onClose={close}
    />,
  );
  act(() => resetGoalCompletionScope());
  await act(async () =>
    resolve({
      ...environments,
      environments: [
        {
          id: "old",
          name: "OLD_SCOPE_CONFIG",
          command: { program: "node", args: [] },
        },
      ],
    } as any),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByText("OLD_SCOPE_CONFIG")).toBeNull();
});
