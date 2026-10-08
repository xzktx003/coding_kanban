import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyProjectAction } from "@agent-orchestrator/shared";

const stops: Array<() => void> = [];
let projects: string[];
let clients: Record<string, number>;
let revision: number;
let offline: boolean;
const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
  if (offline) throw new Error("offline");
  let sequence = 0;
  if (init?.method === "POST") {
    const body = JSON.parse(init.body as string);
    sequence = clients[body.clientId] ?? 0;
    for (const op of body.operations) {
      if (op.seq <= sequence) continue;
      if (op.seq !== sequence + 1) return new Response("{}", { status: 409 });
      projects = applyProjectAction(projects, op.action);
      sequence = op.seq;
      revision++;
    }
    clients[body.clientId] = sequence;
  }
  return new Response(
    JSON.stringify({ initialized: true, revision, projects, sequence }),
  );
});
async function page() {
  vi.resetModules();
  const { useWorkspaceStore: store } =
    await import("../stores/useWorkspaceStore");
  const { startSessionProjectsSync: start } =
    await import("./sessionProjectsSync");
  return {
    store,
    start: () => {
      const stop = start(fetcher as typeof fetch, 1000);
      stops.push(stop);
      return stop;
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fetcher.mockClear();
  projects = ["/existing"];
  clients = {};
  revision = 1;
  offline = false;
  localStorage.setItem(
    "kanban.session.workspace",
    JSON.stringify({
      version: 1,
      state: {
        projects,
        cwd: "/existing",
        projectSyncClientId: "same-browser",
        nextProjectSequence: 1,
        pendingProjectOperations: [],
        projectsInitialized: true,
      },
    }),
  );
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

it("projects added from two pages with the same cached sequence both survive refresh", async () => {
  const first = await page(),
    second = await page();
  first.start();
  second.start();
  await vi.advanceTimersByTimeAsync(1);
  first.store.getState().addProject("/first");
  await vi.advanceTimersByTimeAsync(60);
  second.store.getState().addProject("/second");
  await vi.advanceTimersByTimeAsync(1100);
  expect(projects).toEqual(["/existing", "/first", "/second"]);
  const reopened = await page();
  reopened.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(reopened.store.getState().projects).toEqual(projects);
});

it("an offline add survives a stale page overwriting the workspace cache and an offline reload", async () => {
  const first = await page(),
    second = await page();
  const stop = first.start();
  await vi.advanceTimersByTimeAsync(1);
  offline = true;
  first.store.getState().addProject("/offline-new");
  await vi.advanceTimersByTimeAsync(60);
  stop();
  second.store.getState().setProjectSort("name_desc");
  const reopened = await page();
  expect(reopened.store.getState().projects).toContain("/offline-new");
  offline = false;
  reopened.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(projects).toEqual(["/existing", "/offline-new"]);
  expect(reopened.store.getState().pendingProjectOperations).toHaveLength(0);
});

it("an acknowledged add survives stale cache writes and offline reload without replaying it", async () => {
  const first = await page(),
    second = await page();
  first.start();
  await vi.advanceTimersByTimeAsync(1);
  first.store.getState().addProject("/saved");
  await vi.advanceTimersByTimeAsync(60);
  second.store.getState().setCwd("/existing");
  const reopened = await page();
  expect(reopened.store.getState().projects).toContain("/saved");
  expect(reopened.store.getState().pendingProjectOperations).toHaveLength(0);
});

it("a lost add response retries the same identity without resurrecting a later removed project", async () => {
  const first = await page(),
    second = await page();
  const stop = first.start();
  await vi.advanceTimersByTimeAsync(1);
  const serve = fetcher.getMockImplementation()!;
  fetcher.mockImplementationOnce(async (...args) => {
    await serve(...args);
    throw new Error("response lost after durable write");
  });
  first.store.getState().addProject("/new");
  await vi.advanceTimersByTimeAsync(60);
  stop();
  second.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(second.store.getState().projects).toContain("/new");
  second.store.getState().removeProject("/new");
  await vi.advanceTimersByTimeAsync(100);
  const original = fetcher.mock.calls.find(([, init]) => {
    const body = init?.body && JSON.parse(init.body as string);
    return body?.operations.some((op: any) => op.action.type === "add");
  })!;
  await serve(...original);
  expect(projects).toEqual(["/existing"]);
});

it("an older response cannot overwrite a newer accepted project snapshot", async () => {
  const first = await page(),
    second = await page();
  first.store
    .getState()
    .acceptSharedProjects({
      initialized: true,
      revision: 3,
      projects: ["/existing", "/new"],
    });
  expect(
    second.store
      .getState()
      .acceptSharedProjects({
        initialized: true,
        revision: 2,
        projects: ["/existing"],
      }),
  ).toBe(false);
  expect(second.store.getState().projects).toEqual(["/existing", "/new"]);
});

it("legacy unsent operations finish before new independently identified operations", async () => {
  const first = await page();
  first.store.setState({
    pendingProjectOperations: [
      { seq: 1, action: { type: "add", path: "/legacy" } },
    ],
    nextProjectSequence: 2,
  });
  first.store.getState().addProject("/new");
  first.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(projects).toEqual(["/existing", "/legacy", "/new"]);
  expect(first.store.getState().pendingProjectOperations).toHaveLength(0);
});
