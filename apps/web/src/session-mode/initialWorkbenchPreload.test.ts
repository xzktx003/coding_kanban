import { afterEach, describe, expect, it, vi } from "vitest";

const leaves = [
  "session-tabs",
  "session-projects",
  "session-followups",
  "session-subagents",
  "composer-context",
  "codex-chat-projection",
  "codex-mcp-auth",
  "codex-mcp-version",
] as const;
const appModules = [
  "./App",
  "./components/agent/AgentComposer",
  "./SessionWorkbench",
] as const;

afterEach(() => {
  vi.doUnmock("../lib/workbench-mode");
  vi.doUnmock("./features/thread-workflows/planSnapshot");
  for (const module of appModules) vi.doUnmock(module);
  for (const name of leaves) vi.doUnmock(`@agent-orchestrator/shared/${name}`);
  vi.resetModules();
});

function setup(mode: string, planWindow = false) {
  vi.resetModules();
  const started: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.doMock("../lib/workbench-mode", () => ({
    readWorkbenchMode: () => mode,
  }));
  vi.doMock("./features/thread-workflows/planSnapshot", () => ({
    isPlanWindowRoute: () => planWindow,
  }));
  for (const module of appModules) {
    vi.doMock(module, async () => {
      started.push(module);
      await held;
      return { default: () => null, AgentComposer: () => null };
    });
  }
  for (const name of leaves) {
    vi.doMock(`@agent-orchestrator/shared/${name}`, async () => {
      started.push(name);
      await held;
      return {};
    });
  }
  return { started, release };
}

describe("existing session entry preloading", () => {
  for (const mode of ["terminal", "codex"])
    it(`does not run session leaf or application preload in the ${mode} entry`, async () => {
      const { started, release } = setup(mode);
      try {
        await import("../initial-workbench-preload");
        expect(started).toEqual([]);
      } finally {
        release();
      }
    });

  it("keeps the isolated plan route outside active session preloading", async () => {
    const { started, release } = setup("session", true);
    try {
      await import("../initial-workbench-preload");
      expect(started).toEqual([]);
    } finally {
      release();
    }
  });

  it("keeps the existing idle workbench/app preload independent of the new leaf preload", async () => {
    const { started, release } = setup("terminal");
    try {
      const loader = await import("./sessionWorkbenchLoader");
      loader.preloadSessionWorkbench();
      void loader.preloadSessionApp();
      await vi.waitFor(() => {
        expect(new Set(started)).toEqual(new Set(appModules));
      });
    } finally {
      release();
    }
  });
});
