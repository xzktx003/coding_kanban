import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountSnapshots } from "./accounts.js";
import { KeyedSerial } from "../core/serial.js";
import type { CodexService } from "./client.js";

test("account snapshots protect API-key overwrite, redact auth, restore through native login and reject label collisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-accounts-"));
  const home = join(dir, ".codex");
  await mkdir(home);
  const calls: unknown[] = [];
  const codex = {
    accountOperations: new KeyedSerial(),
    raw: async (method: unknown, params: unknown) => {
      calls.push([method, params]);
      return { type: "chatgptAuthTokens" };
    },
  } as unknown as CodexService;
  const accounts = new AccountSnapshots(codex, { HOME: dir });
  try {
    await writeFile(
      join(home, "auth.json"),
      JSON.stringify({
        tokens: { access_token: "fixture-secret", account_id: "id" },
      }),
    );
    await accounts.save("A B", "a@example.test", "plus");
    assert.deepEqual(await accounts.list(), [
      {
        label: "A B",
        email: "a@example.test",
        planType: "plus",
        isCurrent: true,
      },
    ]);
    assert.equal(
      (await stat(join(home, "codexia-accounts/A_B.json"))).mode & 0o777,
      0o600,
    );
    await assert.rejects(accounts.save("A_B", null, null), /collides/);
    await writeFile(
      join(home, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "api-only" }),
    );
    await accounts.save("A B", "other@example.test", null);
    assert.equal((await accounts.list())[0].email, "a@example.test");
    await accounts.switch("A B");
    assert.deepEqual(calls, [
      [
        "account/login/start",
        {
          type: "chatgptAuthTokens",
          accessToken: "fixture-secret",
          chatgptAccountId: "id",
          chatgptPlanType: "plus",
        },
      ],
    ]);
    await accounts.remove("A B");
    assert.deepEqual(await accounts.list(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
