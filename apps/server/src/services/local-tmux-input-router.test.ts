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

function buildRouter(
  options: {
    getClientPromptBinding?: (
      input: string,
    ) => Promise<"command-prompt" | "confirm-before" | null>;
    waitForTmuxClientReady?: () => Promise<boolean>;
  } = {},
) {
  const session = buildSession();
  const writes: Array<{
    target: "adapter" | "pty";
    input: string;
    terminalProtocolResponse?: boolean;
  }> = [];
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
      ...(options.getClientPromptBinding
        ? { getClientPromptBinding: options.getClientPromptBinding }
        : {}),
    },
    ptyRuntimeManager: {
      has: () => ptyAvailable,
      write: (_agentSessionId: string, input: string, writeOptions) => {
        writes.push({
          target: "pty",
          input,
          ...(writeOptions?.terminalProtocolResponse
            ? { terminalProtocolResponse: true }
            : {}),
        });
      },
      ...(options.waitForTmuxClientReady
        ? { waitForTmuxClientReady: options.waitForTmuxClientReady }
        : {}),
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

test("LocalTmuxInputRouter sends ordinary input through the attached tmux client PTY", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "hello\r" });

  assert.deepEqual(writes, [{ target: "pty", input: "hello\r" }]);
});

test("LocalTmuxInputRouter lets terminal protocol replies bypass a blocked ordinary input", async () => {
  const session = buildSession();
  const writes: Array<{
    input: string;
    terminalProtocolResponse?: boolean;
  }> = [];
  let releaseOrdinaryInput: (() => void) | undefined;
  const router = new LocalTmuxInputRouter({
    registry: { get: () => session },
    tmuxAdapter: {
      async writeInput() {
        throw new Error("attached client input must not use send-keys");
      },
      clearInputState: () => {},
    },
    ptyRuntimeManager: {
      has: () => true,
      write: (_agentSessionId, input, options) => {
        writes.push({
          input,
          terminalProtocolResponse: options?.terminalProtocolResponse,
        });
        if (input !== "ordinary") {
          return;
        }

        return new Promise<void>((resolve) => {
          releaseOrdinaryInput = resolve;
        });
      },
    },
  });

  const ordinary = router.write(session, { input: "ordinary" });
  await new Promise((resolve) => setImmediate(resolve));

  await router.write(session, { input: "\u001b[12;34R" });

  assert.deepEqual(writes, [
    { input: "ordinary", terminalProtocolResponse: undefined },
    { input: "\u001b[12;34R", terminalProtocolResponse: true },
  ]);

  releaseOrdinaryInput?.();
  await ordinary;
});

test("LocalTmuxInputRouter keeps early input out of a tmux client that is still attaching", async () => {
  const { router, session, writes } = buildRouter({
    waitForTmuxClientReady: async () => false,
  });

  await router.write(session, { input: "hello\r" });
  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "," });

  assert.deepEqual(writes, [
    { target: "adapter", input: "hello\r" },
    { target: "adapter", input: "\x02" },
    { target: "adapter", input: "," },
  ]);
});

test("LocalTmuxInputRouter keeps ordinary text on the tmux client after Escape", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x1b" });
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x1b" },
    { target: "pty", input: "plain" },
  ]);
});

test("LocalTmuxInputRouter sends bare Ctrl+C through the tmux client so unknown prompts can be cancelled", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x03" });

  assert.deepEqual(writes, [{ target: "pty", input: "\x03" }]);
});

test("LocalTmuxInputRouter keeps ordinary text on the tmux client after Escape settles", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x1b" });
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x1b" },
    { target: "pty", input: "plain" },
  ]);
});

test("LocalTmuxInputRouter sends cursor input through the attached tmux client", async () => {
  const session = buildSession();
  const writes: string[] = [];
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput() {
        throw new Error("attached client input must not use send-keys");
      },
      clearInputState: () => {},
    },
    ptyRuntimeManager: {
      has: () => true,
      write: (_agentSessionId: string, input: string) => {
        writes.push(input);
      },
    },
  });

  await router.write(session, { input: "\x1b[C" });

  assert.deepEqual(writes, ["\x1b[C"]);
});

test("LocalTmuxInputRouter preserves CSI-u modified Enter through the pane adapter", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x1b[13;2u" });

  assert.deepEqual(writes, [{ target: "adapter", input: "\x1b[13;2u" }]);
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
    { target: "pty", input: "plain" },
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
    { target: "pty", input: "next" },
  ]);
});

test("LocalTmuxInputRouter keeps tmux command-prompt input on the client PTY until Enter", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: ":" });
  await router.write(session, { input: "display-message hello" });
  await router.write(session, { input: "\r" });
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: ":" },
    { target: "pty", input: "display-message hello" },
    { target: "pty", input: "\r" },
    { target: "pty", input: "plain" },
  ]);
});

test("LocalTmuxInputRouter keeps rename-window prompt input on the tmux client PTY until Ctrl+C", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "," });
  await router.write(session, { input: "draft-name" });
  await router.write(session, { input: "\x1b" });
  await router.write(session, { input: "\x03" });
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: "," },
    { target: "pty", input: "draft-name" },
    { target: "pty", input: "\x1b" },
    { target: "pty", input: "\x03" },
    { target: "pty", input: "plain" },
  ]);
});

test("LocalTmuxInputRouter leaves confirm-before mode after its single reply", async () => {
  const { router, session, writes } = buildRouter({
    getClientPromptBinding: async (input) =>
      input === "x" ? "confirm-before" : null,
  });

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "x" });
  await router.write(session, { input: "n" });
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: "x" },
    { target: "pty", input: "n" },
    { target: "pty", input: "plain" },
  ]);
});

test("LocalTmuxInputRouter keeps tmux command-prompt mode after vi Escape until Ctrl+C", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: ":" });
  await router.write(session, { input: "rename-window draft" });
  await router.write(session, { input: "\x1b" });
  await router.write(session, { input: "plain" });
  await router.write(session, { input: "\x03" });
  await router.write(session, { input: "after cancel" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: ":" },
    { target: "pty", input: "rename-window draft" },
    { target: "pty", input: "\x1b" },
    { target: "pty", input: "plain" },
    { target: "pty", input: "\x03" },
    { target: "pty", input: "after cancel" },
  ]);
});

test("LocalTmuxInputRouter cancels tmux command-prompt mode during input cleanup", async () => {
  const { router, session, writes } = buildRouter();

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: ":" });
  await router.write(session, { input: "list-windows" });
  await router.clear(session.id);
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: ":" },
    { target: "pty", input: "list-windows" },
    { target: "pty", input: "\x03" },
    { target: "pty", input: "plain" },
  ]);
});

test("LocalTmuxInputRouter forces mouse/control payloads through the tmux client without pane fallback", async () => {
  const { router, session, writes, setPtyAvailable } = buildRouter();

  await router.write(session, { input: "\x1b[<0;12;8M" }, { forcePty: true });
  await router.write(session, { input: "\x1b[<64;12;8M" }, { forcePty: true });
  setPtyAvailable(false);
  await router.write(session, { input: "\x1b[<0;12;8m" }, { forcePty: true });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x1b[<0;12;8M" },
    { target: "pty", input: "\x1b[<64;12;8M" },
  ]);
});

test("LocalTmuxInputRouter keeps native input on the tmux client after state cleanup", async () => {
  const session = buildSession();
  const writes: string[] = [];
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput() {
        throw new Error("attached client input must not use send-keys");
      },
      clearInputState: () => {},
    },
    ptyRuntimeManager: {
      has: () => true,
      write: (_agentSessionId: string, input: string) => {
        writes.push(input);
      },
    },
  });

  await router.write(session, { input: "\x1b[<0;72;8M" }, { forcePty: true });
  await router.write(session, { input: "typed in the selected pane\r" });

  await router.clear(session.id);
  await router.write(session, { input: "after reconnect\r" });

  assert.deepEqual(writes, [
    "\x1b[<0;72;8M",
    "typed in the selected pane\r",
    "after reconnect\r",
  ]);
});

test("LocalTmuxInputRouter falls back to the registered pane without an attached client", async () => {
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
      has: () => false,
      write: () => {},
    },
  });

  await router.write(session, { input: "detached input\r" });

  assert.equal(adapterTargets[0]?.transportRef?.tmuxPane, "%1");
});

test("LocalTmuxInputRouter keeps text on the tmux client after pane selection commands", async () => {
  const session = buildSession();
  const writes: string[] = [];
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput() {
        throw new Error("attached client input must not use send-keys");
      },
      clearInputState: () => {},
    },
    ptyRuntimeManager: {
      has: () => true,
      write: (_agentSessionId: string, input: string) => {
        writes.push(input);
      },
    },
  });

  await router.write(session, { input: "\x02" });
  await router.write(session, { input: "o" });
  await router.write(session, { input: "typed after select-pane\r" });

  assert.deepEqual(writes, ["\x02", "o", "typed after select-pane\r"]);
});

test("LocalTmuxInputRouter cancels an abandoned prefix when session input state is cleared", async () => {
  const { router, session, writes, clearedInputStateSessionIds } =
    buildRouter();

  await router.write(session, { input: "\x02" });
  await router.clear(session.id);
  await router.write(session, { input: "plain" });

  assert.deepEqual(writes, [
    { target: "pty", input: "\x02" },
    { target: "pty", input: "\x03" },
    { target: "pty", input: "plain" },
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  router.clear(session.id);
  const second = router.write(session, { input: "second" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(started, ["first"]);
  releaseFirstWrite?.();
  await Promise.all([first, second]);
  assert.deepEqual(started, ["first", "second"]);
});

test("LocalTmuxInputRouter orders native client input around cleanup", async () => {
  const session = buildSession();
  const events: string[] = [];
  const router = new LocalTmuxInputRouter({
    registry: {
      get: () => session,
    },
    tmuxAdapter: {
      async writeInput() {
        throw new Error("attached client input must not use send-keys");
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

  await router.write(session, { input: "first" });
  await router.write(session, { input: "\x02" });
  await router.clear(session.id);
  await router.write(session, { input: "plain" });

  assert.deepEqual(events, [
    "pty:first",
    "pty:\x02",
    "pty:\x03",
    "adapter-clear",
    "pty:plain",
  ]);
});
