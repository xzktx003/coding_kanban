import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionRecord,
  StdinAgentSessionInput,
} from "@agent-orchestrator/shared";

import { LocalTmuxInputRouter } from "./local-tmux-input-router.js";

function buildSession(): AgentSessionRecord {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    hostId: "local",
    sourceType: "local",
    agentKind: "shell",
    displayName: "tmux session",
    connectionState: "online",
    interactionState: "running",
    stateConfidence: "high",
    controlMode: "control",
    transportRef: {
      tmuxSession: "session-1",
      tmuxPane: "%1",
    },
  };
}

function buildRouter() {
  const session = buildSession();
  const writes: Array<{ target: "adapter" | "pty"; input: string }> = [];
  const clearedInputStateSessionIds: string[] = [];
  let ptyAvailable = true;

  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput(
        _session: AgentSessionRecord,
        input: StdinAgentSessionInput,
      ) {
        writes.push({ target: "adapter", input: input.input });
        return session;
      },
      clearInputState(agentSessionId: string) {
        clearedInputStateSessionIds.push(agentSessionId);
      },
    },
    ptyRuntimeManager: {
      has: () => ptyAvailable,
      write: (_agentSessionId: string, input: string) => {
        writes.push({ target: "pty", input });
      },
    },
  });

  return {
    router,
    session,
    writes,
    clearedInputStateSessionIds,
    setPtyAvailable(value: boolean) {
      ptyAvailable = value;
    },
  };
}

test("LocalTmuxInputRouter sends ordinary input through the pane adapter", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "hello\r" });

  assert.deepEqual(writes, [{ target: "adapter", input: "hello\r" }]);
});

test("LocalTmuxInputRouter keeps Ctrl+A and Ctrl+B prefix commands on the tmux client PTY", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "%" });
  await router.write(session, { input: "plain" });
  await router.write(session, { input: "\x01" });
  await router.write(session, { input: '"' });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: "%" },
    { target: "adapter", input: "plain" },
    { target: "pty", input: "\x01" },
    { target: "pty", input: '"' },
  ]);
});

test("LocalTmuxInputRouter treats a repeated prefix as the pending tmux command", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "next" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: "\x02" },
    { target: "adapter", input: "next" },
  ]);
});

test("LocalTmuxInputRouter forces mouse/control payloads through the tmux client without pane fallback", async () => {
  const { router, session, writes, setPtyAvailable } = buildRouter();

  await router.write(session, { input: "\x1b[<0;12;8M" }, { forcePty: true });
  setPtyAvailable(false);
  await router.write(session, { input: "\x1b[<0;12;8m" }, { forcePty: true });

  assert.deepEqual(writes, [{ target: "pty", input: "\x1b[<0;12;8M" }]);
});

test("LocalTmuxInputRouter follows the tmux client's active pane after mouse selection", async () => {
  const session = buildSession();
  const adapterTargets: AgentSessionRecord[] = [];
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput(
        targetSession: AgentSessionRecord,
        _input: StdinAgentSessionInput,
      ) {
        adapterTargets.push(targetSession);
        return session;
      },
      clearInputState: () => {},
    },
    ptyRuntimeManager: {
      has: () => true,
      write: () => {},
    },
  });

  await router.write(session, { input: "\x1b[<0;72;8M" }, { forcePty: true });
  await router.write(session, { input: "typed in the selected pane\r" });

  assert.equal(adapterTargets.length, 1);
  assert.equal(adapterTargets[0]?.transportRef?.tmuxSession, "session-1");
  assert.equal(adapterTargets[0]?.transportRef?.tmuxPane, undefined);

  await router.clear(session.id);
  await router.write(session, { input: "after reconnect\r" });

  assert.equal(adapterTargets[1]?.transportRef?.tmuxPane, "%1");
});

test("LocalTmuxInputRouter follows pane changes made by tmux prefix commands", async () => {
  const session = buildSession();
  const adapterTargets: AgentSessionRecord[] = [];
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput(targetSession: AgentSessionRecord) {
        adapterTargets.push(targetSession);
        return session;
      },
      clearInputState: () => {},
    },
    ptyRuntimeManager: {
      has: () => true,
      write: () => {},
    },
  });

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "o" });
  await router.write(session, { input: "typed after select-pane\r" });

  assert.equal(adapterTargets.length, 1);
  assert.equal(adapterTargets[0]?.transportRef?.tmuxSession, "session-1");
  assert.equal(adapterTargets[0]?.transportRef?.tmuxPane, undefined);
});

test("LocalTmuxInputRouter cancels an abandoned prefix when session input state is cleared", async () => {
  const { router, session, writes, clearedInputStateSessionIds } =
    buildRouter();

  await router.write(session, { input: "\x02" });
  await router.clear(session.id);
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: "\x1b" },
    { target: "adapter", input: "plain" },
  ]);
  assert.deepEqual(clearedInputStateSessionIds, [session.id]);
});

test("LocalTmuxInputRouter still clears adapter state when the PTY exits during prefix cancellation", async () => {
  const session = buildSession();
  const clearedInputStateSessionIds: string[] = [];
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput() {
        return session;
      },
      clearInputState(agentSessionId: string) {
        clearedInputStateSessionIds.push(agentSessionId);
      },
    },
    ptyRuntimeManager: {
      has: () => true,
      write: (_agentSessionId: string, input: string) => {
        if (input === "\x1b") {
          throw new Error("PTY exited");
        }
      },
    },
  });

  await router.write(session, { input: "\x02" });
  await assert.doesNotReject(router.clear(session.id));
  assert.deepEqual(clearedInputStateSessionIds, [session.id]);
});

test("LocalTmuxInputRouter keeps queued writes ordered when input state is cleared", async () => {
  const session = buildSession();
  const started: string[] = [];
  let releaseFirstWrite: (() => void) | undefined;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput(
        _session: AgentSessionRecord,
        input: StdinAgentSessionInput,
      ) {
        started.push(input.input);
        if (input.input === "first") {
          await firstWriteGate;
        }
        return session;
      },
      clearInputState: () => {},
    },
    ptyRuntimeManager: {
      has: () => false,
      write: () => {},
    },
  });

  const first = router.write(session, { input: "first" });
  await Promise.resolve();
  router.clear(session.id);
  const second = router.write(session, { input: "second" });
  await Promise.resolve();

  assert.deepEqual(started, ["first"]);
  releaseFirstWrite?.();
  await Promise.all([first, second]);
  assert.deepEqual(started, ["first", "second"]);
});

test("LocalTmuxInputRouter queues cleanup after an earlier write and queued prefix", async () => {
  const session = buildSession();
  const events: string[] = [];
  let releaseFirstWrite: (() => void) | undefined;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput(
        _session: AgentSessionRecord,
        input: StdinAgentSessionInput,
      ) {
        events.push(`adapter-start:${input.input}`);
        if (input.input === "first") {
          await firstWriteGate;
        }
        events.push(`adapter-end:${input.input}`);
        return session;
      },
      clearInputState: () => {
        events.push("adapter-clear");
      },
    },
    ptyRuntimeManager: {
      has: () => true,
      write: (_agentSessionId: string, input: string) => {
        events.push(`pty:${input}`);
      },
    },
  });

  const first = router.write(session, { input: "first" });
  await Promise.resolve();
  const prefix = router.write(session, { input: "\x02" });
  const cleanup = router.clear(session.id);
  const plain = router.write(session, { input: "plain" });
  await Promise.resolve();

  assert.deepEqual(events, ["adapter-start:first"]);

  releaseFirstWrite?.();
  await Promise.all([first, prefix, Promise.resolve(cleanup), plain]);

  assert.deepEqual(events, [
    "adapter-start:first",
    "adapter-end:first",
    "pty:\x02",
    "pty:\x1b",
    "adapter-clear",
    "adapter-start:plain",
    "adapter-end:plain",
  ]);
});
