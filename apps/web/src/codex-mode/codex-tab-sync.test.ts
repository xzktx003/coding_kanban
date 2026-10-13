import { afterEach, expect, it, vi } from "vitest";
import type { CodexFollowedThread, SharedCodexTabs } from "@agent-orchestrator/shared";
import { CODEX_MULTIWINDOW_KEY } from "./codex-multiwindow-state";
import { CODEX_TAB_OPERATION_PREFIX, saveCodexTabOperation } from "./codex-tab-journal";
import { queueCodexTab, reduceCodexTabs, startCodexTabSync, type CodexTabSyncState } from "./codex-tab-sync";

const alpha: CodexFollowedThread = { id: "019aabcd-1234-7890-abcd-000000000001", cwd: "/tmp/project-a", title: "Alpha" };
const beta: CodexFollowedThread = { id: "019aabcd-1234-7890-abcd-000000000002", cwd: "/tmp/project-b", title: "Beta" };
const empty: CodexTabSyncState = { threads: [], detached: null, pending: [], initialized: false, error: null };
const snapshot = (revision: number, threads: CodexFollowedThread[]): SharedCodexTabs => ({ initialized: true, revision, threads });

afterEach(() => localStorage.clear());

it("keeps a remotely removed thread visible locally and replays an offline close after refresh", () => {
  localStorage.setItem(CODEX_MULTIWINDOW_KEY, JSON.stringify({
    version: 1, hostKey: "native-default", layout: "split", activeId: alpha.id,
    windows: [{ id: alpha.id, kind: "thread", title: alpha.title, cwd: alpha.cwd, threadId: alpha.id }],
  }));
  const opened = reduceCodexTabs({ ...empty, threads: [alpha] }, snapshot(2, []));
  expect(opened.threads).toEqual([]);
  expect(opened.detached).toEqual(alpha);
  expect(JSON.parse(localStorage.getItem(CODEX_MULTIWINDOW_KEY)!).layout).toBe("split");

  localStorage.clear();
  const closed = queueCodexTab({ ...empty, threads: [alpha, beta] }, { type: "remove", id: beta.id });
  expect(closed.threads.map((thread) => thread.id)).toEqual([alpha.id]);
  expect(localStorage.getItem(CODEX_TAB_OPERATION_PREFIX + closed.pending[0]!.id)).toContain(beta.id);
  const refreshed = reduceCodexTabs(empty, snapshot(1, [alpha, beta]));
  expect(refreshed.threads.map((thread) => thread.id)).toEqual([alpha.id]);
  expect(refreshed.pending).toHaveLength(1);
});

it("shares membership across browsers while each browser keeps its own selection and layout", async () => {
  vi.useFakeTimers();
  const states: CodexTabSyncState[] = [];
  const requests: Array<{ method?: string; body?: string }> = [];
  let remote = snapshot(0, [] as CodexFollowedThread[]);
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { seed?: CodexFollowedThread[]; operations: Array<{ action: { type: string; thread?: CodexFollowedThread; id?: string } }> };
      if (remote.revision === 0 && body.seed) remote = { initialized: true, revision: 0, threads: body.seed };
      const action = body.operations[0]?.action;
      const threads = action?.type === "add" && action.thread ? [...remote.threads, action.thread]
        : action?.type === "remove" ? remote.threads.filter((thread) => thread.id !== action.id) : remote.threads;
      remote = { initialized: true, revision: remote.revision + 1, threads };
      return new Response(JSON.stringify({ ...remote, sequence: 1 }));
    }
    return new Response(JSON.stringify(remote));
  });
  const first = startCodexTabSync({ fetcher: fetcher as typeof fetch, pollMs: 1000, seed: [alpha], onChange: (state) => states.push(state) });
  await vi.advanceTimersByTimeAsync(1);
  expect(remote.threads).toEqual([alpha]);
  first.queue({ type: "add", thread: beta });
  await vi.advanceTimersByTimeAsync(50);
  const secondStates: CodexTabSyncState[] = [];
  const second = startCodexTabSync({ fetcher: fetcher as typeof fetch, pollMs: 1000, seed: [], onChange: (state) => secondStates.push(state) });
  await vi.advanceTimersByTimeAsync(1);
  expect(secondStates.at(-1)?.threads.map((thread) => thread.id)).toEqual([alpha.id, beta.id]);
  const posted = requests.filter((request) => request.method === "POST").map((request) => request.body ?? "");
  expect(posted.some((body) => body.includes(alpha.id))).toBe(true);
  expect(posted.some((body) => body.includes(beta.id))).toBe(true);
  first.stop();
  second.stop();
  vi.useRealTimers();
});

it("does not let another page's stale cache erase a close that is still awaiting acknowledgement", () => {
  saveCodexTabOperation({ type: "remove", id: beta.id }, "close-beta");
  localStorage.setItem("kanban.codex.multiwindow.v1", JSON.stringify({ windows: [alpha, beta] }));
  const restored = reduceCodexTabs(empty, snapshot(4, [alpha, beta]));
  expect(restored.threads).toEqual([alpha]);
  expect(restored.pending[0]?.id).toBe("close-beta");
});
