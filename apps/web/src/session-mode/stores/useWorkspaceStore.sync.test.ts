import { beforeEach, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({
    projects: ["/a", "/b"],
    cwd: "/a",
    historyProjects: ["/a"],
    projectSort: "added_asc",
    pendingProjectOperations: [],
    nextProjectSequence: 1,
    projectsInitialized: false,
  });
});
it("shared project changes preserve local current directory/history/sort and pending offline edits", () => {
  const ws = useWorkspaceStore.getState();
  ws.addProject("/local");
  ws.acceptSharedProjects({
    initialized: true,
    revision: 1,
    projects: ["/b", "/remote"],
  });
  expect(useWorkspaceStore.getState().projects).toEqual([
    "/b",
    "/remote",
    "/local",
  ]);
  expect(useWorkspaceStore.getState().cwd).toBe("/a");
  expect(useWorkspaceStore.getState().historyProjects).toEqual([
    "/local",
    "/a",
  ]);
  expect(useWorkspaceStore.getState().projectSort).toBe("added_asc");
});
it("offline mutations and device settings survive browser reload, and remote hydration does not enqueue writes", async () => {
  const ws = useWorkspaceStore.getState();
  ws.addProject("/c");
  ws.setCwd("/c");
  const saved = localStorage.getItem("kanban.session.workspace")!;
  useWorkspaceStore.setState({
    projects: [],
    cwd: null,
    pendingProjectOperations: [],
  });
  localStorage.setItem("kanban.session.workspace", saved);
  await useWorkspaceStore.persist.rehydrate();
  expect(useWorkspaceStore.getState().projects).toEqual(["/a", "/b", "/c"]);
  expect(useWorkspaceStore.getState().cwd).toBe("/c");
  expect(useWorkspaceStore.getState().pendingProjectOperations).toHaveLength(1);
  ws.acceptSharedProjects(
    { initialized: true, revision: 2, projects: ["/b", "/c"] },
    undefined,
    useWorkspaceStore.getState().pendingProjectOperations.map((op) => op.id!),
  );
  expect(useWorkspaceStore.getState().pendingProjectOperations).toEqual([]);
});

it("unchanged polling snapshots do not notify UI subscribers", () => {
  const snapshot = { initialized: true, revision: 1, projects: ["/a"] };
  useWorkspaceStore.getState().acceptSharedProjects(snapshot);
  const baseline = useWorkspaceStore.getState();
  let notifications = 0;
  const stop = useWorkspaceStore.subscribe(() => notifications++);
  try {
    for (let i = 0; i < 30; i++)
      useWorkspaceStore
        .getState()
        .acceptSharedProjects(JSON.parse(JSON.stringify(snapshot)));
    expect(notifications).toBe(0);
    expect(useWorkspaceStore.getState()).toBe(baseline);
  } finally {
    stop();
  }
});
