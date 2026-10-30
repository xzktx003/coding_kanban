import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Explicit equivalent observer: actual HTTP/API/EventSource, all CDP Network
// callbacks, one 4 MiB/1 MiB debugger body cache. The original Playwright soak
// and its historical failures remain unchanged and separately reported.
test("native HTTP natural memory with a fixed complete Network observer", async ({}, testInfo) => {
  test.skip(
    process.env.SESSION_NATIVE_HTTP_MEMORY_RUN !== "1",
    "Explicit SESSION_NATIVE_HTTP_MEMORY_RUN=1 and a frozen source are required",
  );
  const minutes = Number(
    process.env.SESSION_NATIVE_HTTP_MEMORY_MINUTES ?? "30",
  );
  const smoke = process.env.SESSION_NATIVE_HTTP_MEMORY_SMOKE === "1";
  expect(minutes === 30 || (smoke && minutes > 0 && minutes <= 1)).toBe(true);
  test.setTimeout((minutes * 60 + 150) * 1000);
  const output =
    process.env.SESSION_NATIVE_HTTP_MEMORY_OUTPUT ??
    testInfo.outputPath("native-http-memory");
  const log = createWriteStream(
    testInfo.outputPath("native-http-memory-driver.log"),
  );
  const child = spawn(
    process.execPath,
    [
      resolve("packages/session-runtime/node_modules/tsx/dist/cli.mjs"),
      resolve("tests/e2e/helpers/session-native-http-memory.mts"),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SESSION_NATIVE_HTTP_MEMORY_MINUTES: String(minutes),
        SESSION_NATIVE_HTTP_MEMORY_OUTPUT: output,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  expect(child.pid).toBeGreaterThan(0);
  const statPath = `/proc/${child.pid}/stat`;
  const startTicks = (stat: string) =>
    stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/)[19];
  const ownedTicks = startTicks(await readFile(statPath, "utf8"));
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let exited = false;
  const completed = new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      exited = true;
      done(code);
    });
  });
  const deadline = setTimeout(
    async () => {
      if (exited) return;
      try {
        if (startTicks(await readFile(statPath, "utf8")) === ownedTicks)
          child.kill("SIGTERM");
      } catch {
        /* Already exited; never signal a replacement PID. */
      }
    },
    (minutes * 60 + 120) * 1000,
  );
  try {
    expect(await completed).toBe(0);
    const result = JSON.parse(
      await readFile(join(output, "capped.json"), "utf8"),
    );
    expect(result.completed).toBe(true);
    expect(result.formalAcceptance).toBe(minutes === 30);
    await testInfo.attach("native-http-memory.json", {
      path: join(output, "capped.json"),
      contentType: "application/json",
    });
  } finally {
    clearTimeout(deadline);
    if (!exited) {
      try {
        if (startTicks(await readFile(statPath, "utf8")) === ownedTicks)
          child.kill("SIGTERM");
      } catch {
        /* No authority to signal any different process. */
      }
      await completed;
    }
    await new Promise<void>((done) => log.end(done));
  }
});
