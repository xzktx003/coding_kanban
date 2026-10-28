import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { createClaudeService } from "./service.js";
import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Rewind / fork / rename go through the SDK's own control requests. The
 * capabilities were verified present in 0.3.296 (`Query.rewindFiles`,
 * `forkSession`, `renameSession`), so no private CLI channel is involved.
 *
 * Reference: docs/designs/claude-render-alignment/plan-20261027.md §4
 */

class Stream<T> implements AsyncIterableIterator<T> {
  values: T[] = [];
  ended = false;
  [Symbol.asyncIterator]() {
    return this;
  }
  waiting?: (v: IteratorResult<T>) => void;
  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
    // Staying open matters: once the stream ends, the service clears
    // session.query, and a later control request would look unsupported.
    return new Promise((resolve) => (this.waiting = resolve));
  }
  close() {
    this.ended = true;
    this.waiting?.({ value: undefined as never, done: true });
  }
}

function harness(overrides: Partial<Query> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query = Object.assign(new Stream<never>(), {
    // `ensure()` awaits this before any control request, same as the CLI.
    initializationResult: async () => ({}),
    interrupt: async () => {},
    setPermissionMode: async () => {},
    close: () => {},
    rewindFiles: async (...args: unknown[]) => {
      calls.push({ method: "rewindFiles", args });
      return { canRewind: true, filesChanged: ["a.ts"], insertions: 2 };
    },
    ...overrides,
  }) as unknown as Query;
  return { calls, query };
}

async function withService(
  fn: (service: ReturnType<typeof createClaudeService>, id: string, calls: Array<{ method: string; args: unknown[] }>) => Promise<void>,
  overrides: Partial<Query> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "cc-rewind-"));
  const { calls, query } = harness(overrides);
  const service = createClaudeService({
    hub: new EventHub(),
    dataHome: dir,
    env: { SESSION_CLAUDE_BIN: "/bin/true" },
    queryFactory: (() => query) as never,
  });
  try {
    const id = await service.newSession({
      cwd: dir,
      enableFileCheckpointing: true,
    });
    await fn(service, id, calls);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("checkpointing must be enabled before a session can rewind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-rewind-off-"));
  const { query } = harness();
  const service = createClaudeService({
    hub: new EventHub(),
    dataHome: dir,
    env: { SESSION_CLAUDE_BIN: "/bin/true" },
    queryFactory: (() => query) as never,
  });
  try {
    // No enableFileCheckpointing: rewinding has no backups to restore from,
    // so it must be refused rather than silently doing nothing.
    const id = await service.newSession({ cwd: dir });
    await assert.rejects(
      () => service.rewindFiles(id, "11111111-1111-4111-8111-111111111111"),
      /checkpoint/i,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rewind forwards the message id and dry-run flag to the SDK", async () => {
  await withService(async (service, id, calls) => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const result = await service.rewindFiles(id, uuid, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "rewindFiles");
    assert.equal(calls[0].args[0], uuid);
    assert.deepEqual(calls[0].args[1], { dryRun: true });
    assert.equal((result as { canRewind: boolean }).canRewind, true);
  });
});

test("rewind defaults to a real run, not a preview", async () => {
  await withService(async (service, id, calls) => {
    await service.rewindFiles(id, "11111111-1111-4111-8111-111111111111");
    assert.deepEqual(calls[0].args[1], { dryRun: false });
  });
});

test("a malformed message id is rejected before reaching the SDK", async () => {
  await withService(async (service, id, calls) => {
    await assert.rejects(() => service.rewindFiles(id, "not-a-uuid"), /Invalid/);
    await assert.rejects(() => service.rewindFiles(id, ""), /Invalid/);
    // Nothing may reach the CLI for an input we already know is bad.
    assert.equal(calls.length, 0);
  });
});

test("an unknown session cannot be rewound", async () => {
  await withService(async (service) => {
    await assert.rejects(
      () =>
        service.rewindFiles(
          "22222222-2222-4222-8222-222222222222",
          "11111111-1111-4111-8111-111111111111",
        ),
      /not found/i,
    );
  });
});

test("a refusal from the CLI is surfaced, not swallowed", async () => {
  await withService(
    async (service, id) => {
      const result = await service.rewindFiles(
        id,
        "11111111-1111-4111-8111-111111111111",
      );
      // canRewind false must reach the caller so the UI can explain it.
      assert.equal((result as { canRewind: boolean }).canRewind, false);
      assert.match((result as { error?: string }).error ?? "", /no checkpoint/i);
    },
    {
      rewindFiles: async () => ({
        canRewind: false,
        error: "no checkpoint found for this message",
      }),
    } as Partial<Query>,
  );
});

test("link-safety skips are reported verbatim", async () => {
  // The SDK only populates skippedLinks on a real rewind; the count must not
  // be invented or rounded away.
  await withService(
    async (service, id) => {
      const result = (await service.rewindFiles(
        id,
        "11111111-1111-4111-8111-111111111111",
      )) as { skippedLinks?: number };
      assert.equal(result.skippedLinks, 2);
    },
    {
      rewindFiles: async () => ({ canRewind: true, skippedLinks: 2 }),
    } as Partial<Query>,
  );
});
