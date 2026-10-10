import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { createClaudeService } from "./service.js";
import type {
  Query,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
class Stream<T> implements AsyncIterableIterator<T> {
  values: T[] = [];
  waiting?: (v: IteratorResult<T>) => void;
  ended = false;
  [Symbol.asyncIterator]() {
    return this;
  }
  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => (this.waiting = resolve));
  }
  push(value: T) {
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = undefined;
      w({ value, done: false });
    } else this.values.push(value);
  }
  close() {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
  }
}
test("Claude streams to caller identity; overlap is rejected; modes update hook; prompt reply belongs to live turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-service-"));
  const hub = new EventHub();
  let opts: Options | undefined;
  let input: AsyncIterable<SDKUserMessage> | undefined;
  const output = new Stream<SDKMessage>();
  const service = createClaudeService({
    hub,
    dataHome: dir,
    env: { HOME: dir, PATH: process.env.PATH },
    queryFactory: (params) => {
      opts = params.options;
      input = params.prompt as AsyncIterable<SDKUserMessage>;
      return Object.assign(output, {
        initializationResult: async () => ({}),
        setPermissionMode: async () => {},
        interrupt: async () => {},
        close: () => Stream.prototype.close.call(output),
      }) as unknown as Query;
    },
  });
  try {
    const id = await service.newSession({ cwd: dir });
    await service.send(id, "hello", []);
    assert.ok(input);
    assert.equal(
      (await input[Symbol.asyncIterator]().next()).value?.session_id,
      id,
    );
    await assert.rejects(service.send(id, "overlap", []), /already running/);
    const hook = opts!.hooks!.PreToolUse![0].hooks[0];
    const signal = new AbortController().signal;
    const approval = hook(
      {
        hook_event_name: "PreToolUse",
        session_id: "native",
        transcript_path: "",
        cwd: dir,
        tool_name: "Bash",
        tool_input: { command: "pwd" },
        tool_use_id: "t",
      },
      "t",
      { signal },
    );
    await new Promise((r) => setTimeout(r, 5));
    const events = hub.subscribe({ since: 0 }).backlog;
    const request = events.find((e) => e.event === "cc-permission-request")!;
    assert.equal(request.payload.sessionId, id);
    await service.resolvePermission(
      String(request.payload.requestId),
      "allow_project",
    );
    assert.equal(
      ((await approval) as any).hookSpecificOutput.permissionDecision,
      "allow",
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(dir, ".claude/settings.json"), "utf8"))
        .permissions.allow,
      ["Bash"],
    );
    await assert.rejects(
      service.resolvePermission(String(request.payload.requestId), "allow"),
      /not found/,
    );
    output.push({
      type: "result",
      subtype: "success",
      session_id: "native",
      is_error: false,
    } as SDKMessage);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(
      hub.subscribe({ since: 0 }).backlog.find((e) => e.event === "cc-message")
        ?.payload.session_id,
      id,
    );
    await service.setPermissionMode(id, "dontAsk");
    assert.equal(
      (
        (await hook(
          {
            hook_event_name: "PreToolUse",
            session_id: "native",
            transcript_path: "",
            cwd: dir,
            tool_name: "Bash",
            tool_input: {},
            tool_use_id: "t",
          },
          "t",
          { signal },
        )) as any
      ).hookSpecificOutput.permissionDecision,
      "deny",
    );
    await service.send(id, "next", []);
  } finally {
    await service.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude startup failure emits terminal result and releases execution ownership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-failure-"));
  const hub = new EventHub();
  const service = createClaudeService({
    hub,
    dataHome: dir,
    env: { HOME: dir },
    queryFactory: () => {
      throw new Error("fixture startup failure");
    },
  });
  try {
    const id = await service.newSession({ cwd: dir });
    await assert.rejects(
      service.sendAndWait(id, "hello"),
      /fixture startup failure/,
    );
    assert.equal(service.activeCount, 0);
    const result = hub
      .subscribe({ since: 0 })
      .backlog.find((e) => e.payload.type === "result");
    assert.equal(result?.payload.is_error, true);
    assert.equal(result?.payload.session_id, id);
  } finally {
    await service.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude rejects invalid options before spawning and does not spawn a process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-input-"));
  const hub = new EventHub();
  let starts = 0;
  const service = createClaudeService({
    hub,
    dataHome: dir,
    env: { HOME: dir },
    queryFactory: () => {
      starts++;
      throw new Error("unexpected spawn");
    },
  });
  try {
    await assert.rejects(
      service.newSession({ cwd: dir, maxTurns: -2 }),
      /maxTurns/,
    );
    await assert.rejects(
      service.newSession({ cwd: dir, allowedTools: [3] }),
      /allowedTools/,
    );
    assert.equal(starts, 0);
  } finally {
    await service.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});
