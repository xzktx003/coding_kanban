import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeConfig } from "./config.js";
import { ClaudeUsage } from "./usage.js";
test("Claude usage keeps token server-side, shares inflight cache, validates windows and redacts errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-usage-"));
  await mkdir(join(home, ".claude"));
  await writeFile(
    join(home, ".claude", ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "fixture-token" } }),
  );
  let calls = 0;
  let status = 200;
  const fetcher = (async (_url, init) => {
    calls++;
    assert.equal(
      (init!.headers as Record<string, string>).Authorization,
      "Bearer fixture-token",
    );
    return new Response(
      JSON.stringify({
        five_hour: { utilization: 34, resets_at: "soon" },
        seven_day: { utilization: 101 },
        secret: "fixture-token",
      }),
      { status },
    );
  }) as typeof fetch;
  try {
    const usage = new ClaudeUsage(new ClaudeConfig({ HOME: home }), fetcher);
    const [a, b] = await Promise.all([usage.read(), usage.read()]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    assert.deepEqual(a.fiveHour, { usedPercent: 34, resetsAt: "soon" });
    assert.equal(a.sevenDay, null);
    assert.ok(!JSON.stringify(a).includes("fixture-token"));
    await usage.read();
    assert.equal(calls, 1);
    status = 401;
    await assert.rejects(usage.read(true), /login expired/);
    assert.equal(calls, 2);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
