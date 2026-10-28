import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { createClaudeService } from "./service.js";

/**
 * Fork and rename are module-level SDK functions operating on the session
 * JSONL, not control requests on a live Query. They work on sessions that are
 * not currently connected, so they must not require a mounted session.
 *
 * Reference: docs/designs/claude-render-alignment/plan-20261027.md §4.1
 */

const SESSION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";

async function withService(
  fn: (
    service: ReturnType<typeof createClaudeService>,
    dir: string,
    calls: Array<{ method: string; args: unknown[] }>,
  ) => Promise<void>,
  overrides: {
    fork?: (...args: unknown[]) => Promise<{ sessionId: string }>;
    rename?: (...args: unknown[]) => Promise<void>;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "cc-fork-"));
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const service = createClaudeService({
    hub: new EventHub(),
    dataHome: dir,
    env: { SESSION_CLAUDE_BIN: "/bin/true" },
    sessionOps: {
      forkSession: async (...args: unknown[]) => {
        calls.push({ method: "forkSession", args });
        return overrides.fork
          ? overrides.fork(...args)
          : { sessionId: "33333333-3333-4333-8333-333333333333" };
      },
      renameSession: async (...args: unknown[]) => {
        calls.push({ method: "renameSession", args });
        if (overrides.rename) await overrides.rename(...args);
      },
    },
  } as never);
  try {
    await fn(service, dir, calls);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("fork returns the new session id and forwards the slice point", async () => {
  await withService(async (service, dir, calls) => {
    const result = await service.forkSession(SESSION, {
      upToMessageId: MESSAGE,
      title: "Branch A",
      cwd: dir,
    });
    assert.equal(result.sessionId, "33333333-3333-4333-8333-333333333333");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0], SESSION);
    assert.deepEqual(calls[0].args[1], {
      dir,
      upToMessageId: MESSAGE,
      title: "Branch A",
    });
  });
});

test("fork works without a slice point or title", async () => {
  // Omitting upToMessageId copies the whole transcript, per the SDK contract.
  await withService(async (service, dir, calls) => {
    await service.forkSession(SESSION, { cwd: dir });
    assert.deepEqual(calls[0].args[1], { dir });
  });
});

test("fork does not require the session to be connected", async () => {
  // A fork reads the JSONL, so refusing unmounted sessions would block the
  // main use case: branching from history.
  await withService(async (service, dir) => {
    const result = await service.forkSession(SESSION, { cwd: dir });
    assert.ok(result.sessionId);
  });
});

test("fork refuses a session id that could escape the project directory", async () => {
  // Session ids are not all UUIDs here (the product uses ids like
  // "attachment-a"), so the charset check exists for path safety: the id
  // becomes part of a JSONL lookup. Traversal must never reach the store.
  await withService(async (service, dir, calls) => {
    for (const id of [
      "../../etc/passwd",
      "has/slash",
      "has\\backslash",
      "nul\0byte",
      "",
      "x".repeat(201),
    ])
      await assert.rejects(
        () => service.forkSession(id, { cwd: dir }),
        /Invalid session ID/,
        id,
      );
    assert.equal(calls.length, 0);
  });
});

test("fork validates the slice point as a real message uuid", async () => {
  // Unlike the session id, a message id is always a UUID, so it gets the
  // stricter check.
  await withService(async (service, dir, calls) => {
    await assert.rejects(
      () => service.forkSession(SESSION, { upToMessageId: "nope", cwd: dir }),
      /Invalid user message id/,
    );
    assert.equal(calls.length, 0);
  });
});

test("fork rejects a title that is empty or carries a NUL", async () => {
  await withService(async (service, dir, calls) => {
    await assert.rejects(
      () => service.forkSession(SESSION, { title: "   ", cwd: dir }),
      /Invalid title/,
    );
    await assert.rejects(
      () => service.forkSession(SESSION, { title: "a\0b", cwd: dir }),
      /Invalid title/,
    );
    assert.equal(calls.length, 0);
  });
});

test("rename forwards the trimmed title", async () => {
  await withService(async (service, dir, calls) => {
    await service.renameSession(SESSION, "  New name  ", dir);
    assert.equal(calls[0].method, "renameSession");
    assert.equal(calls[0].args[0], SESSION);
    assert.equal(calls[0].args[1], "New name");
    assert.deepEqual(calls[0].args[2], { dir });
  });
});

test("rename rejects an empty or over-long title", async () => {
  await withService(async (service, dir, calls) => {
    await assert.rejects(
      () => service.renameSession(SESSION, "", dir),
      /Invalid title/,
    );
    await assert.rejects(
      () => service.renameSession(SESSION, "   ", dir),
      /Invalid title/,
    );
    // The composer caps names at 128 characters elsewhere in the product.
    await assert.rejects(
      () => service.renameSession(SESSION, "x".repeat(129), dir),
      /Invalid title/,
    );
    assert.equal(calls.length, 0);
  });
});

test("a failure from the session store is surfaced", async () => {
  await withService(
    async (service, dir) => {
      await assert.rejects(
        () => service.forkSession(SESSION, { cwd: dir }),
        /no rollout/i,
      );
    },
    {
      fork: async () => {
        throw new Error("no rollout found for session");
      },
    },
  );
});
