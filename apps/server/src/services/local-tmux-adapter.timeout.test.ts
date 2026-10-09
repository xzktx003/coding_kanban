import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { AgentSessionRegistry } from "./agent-session-registry.js";
import { quoteForPosixShell } from "./runtime-compat.js";

test("an unresponsive tmux command times out, reaps only its query process and permits retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanban-tmux-timeout-"));
  const binary = join(dir, "tmux");
  const pidFile = join(dir, "query.pid");
  const originalBinary = process.env.TMUX_BINARY;
  writeFileSync(
    binary,
    [
      "#!/bin/sh",
      'if [ "$1" = "-V" ]; then echo "tmux fixture"; exit 0; fi',
      `exec ${quoteForPosixShell(process.execPath)} -e ${quoteForPosixShell(
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`,
      )}`,
    ].join("\n"),
    { mode: 0o700 },
  );
  process.env.TMUX_BINARY = binary;
  const { LocalTmuxAdapter } = await import("./local-tmux-adapter.js");
  const adapter = new LocalTmuxAdapter(new AgentSessionRegistry(), {
    commandTimeoutMs: 150,
  });
  try {
    for (let i = 0; i < 2; i++) {
      const operation = adapter.discover();
      try {
        await assert.rejects(
          Promise.race([
            operation,
            sleep(700).then(() => {
              throw new Error("query exceeded the test deadline");
            }),
          ]),
          /tmux.*超时/,
        );
        const pid = Number(readFileSync(pidFile, "utf8"));
        assert.throws(() => process.kill(pid, 0), /ESRCH/);
      } finally {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
        } catch {}
        await operation.catch(() => {});
      }
    }
  } finally {
    if (originalBinary === undefined) delete process.env.TMUX_BINARY;
    else process.env.TMUX_BINARY = originalBinary;
    rmSync(dir, { recursive: true, force: true });
  }
});
