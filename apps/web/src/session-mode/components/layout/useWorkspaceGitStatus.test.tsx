import { act, render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useWorkspaceGitStatus } from "./useWorkspaceGitStatus";
const observation = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), watch: vi.fn() }));
vi.mock("@session/hooks/useGitWatch", () => ({ useGitWatch: (...args: unknown[]) => observation.watch(...args) }));
vi.mock("@session/stores/useGitStatsStore", () => ({ useGitStatsStore: (selector: (state: {refreshStats: typeof observation.refresh}) => unknown) => selector({ refreshStats: observation.refresh }) }));
beforeEach(() => { observation.refresh.mockClear(); observation.watch.mockClear(); useWorkspaceStore.setState({cwd:"/first"}); });
test("workspace metadata remains live independently of optional panel mounting and a stable watch follows the current cwd", () => {
  function Observer() { useWorkspaceGitStatus(); return null; }
  const view=render(<Observer />);
  expect(observation.refresh).toHaveBeenLastCalledWith("/first",false);
  const callback=observation.watch.mock.calls.at(-1)![1] as () => void;
  act(() => useWorkspaceStore.setState({cwd:"/second"}));
  expect(observation.refresh).toHaveBeenLastCalledWith("/second",false);
  expect(observation.watch.mock.calls.at(-1)![1]).toBe(callback);
  callback(); expect(observation.refresh).toHaveBeenLastCalledWith("/second",true);
  act(() => useWorkspaceStore.setState({cwd:null}));
  const count=observation.refresh.mock.calls.length;
  callback(); expect(observation.refresh).toHaveBeenCalledTimes(count);
  expect(observation.watch).toHaveBeenLastCalledWith(null,callback,false);
  view.unmount();
});
