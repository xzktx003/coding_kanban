import assert from "node:assert/strict";
import test from "node:test";
import { sampleRendererRss } from "./session-renderer-memory.mjs";

const renderer = (id) => ({ id, type: "renderer" });
const status = (pid, rss = "1024 kB") =>
  `Name:\tfixture\nPid:\t${pid}\nVmRSS:\t${rss}\n`;
function stat(pid, ticks = "1000", comm = "fixture renderer") {
  // Linux stat field 22: start time, after state plus fields 4 through 21.
  return `${pid} (${comm}) S ${Array(18).fill("0").join(" ")} ${ticks} 0 0\n`;
}
function proc(rows) {
  const reads = [];
  const calls = new Map();
  const read = (path) => {
    reads.push(path);
    const match = /^\/proc\/(\d+)\/(status|stat)$/.exec(path);
    assert.ok(match, `Unexpected proc path: ${path}`);
    const row = rows[match[1]];
    assert.ok(row, `Unexpected PID read: ${match[1]}`);
    const count = calls.get(path) ?? 0;
    calls.set(path, count + 1);
    const value = row[match[2]];
    if (value instanceof Error) throw value;
    return Array.isArray(value)
      ? value[Math.min(count, value.length - 1)]
      : value;
  };
  return { read, reads };
}

test("sums only renderer RSS and records stable PID/start-tick identities", () => {
  const source = proc({
    101: { status: status(101, "1024 kB"), stat: stat(101, "1000") },
    202: { status: status(202, "2048 kB"), stat: stat(202, "2000") },
  });
  const measured = sampleRendererRss(
    [renderer(101), { type: "browser", id: 303 }, renderer(202)],
    source.read,
  );
  assert.equal(measured.rendererRssBytes, 3072 * 1024);
  assert.deepEqual(measured.rendererProcesses, [
    { pid: 101, startTicks: "1000", rssBytes: 1024 * 1024 },
    { pid: 202, startTicks: "2000", rssBytes: 2048 * 1024 },
  ]);
  assert.equal(source.reads.filter((path) => path.endsWith("/stat")).length, 4);
});

test("parses a process command containing spaces and parentheses", () => {
  const source = proc({
    101: {
      status: status(101),
      stat: stat(101, "3456", "renderer ) ( worker"),
    },
  });
  assert.equal(
    sampleRendererRss([renderer(101)], source.read).rendererProcesses[0]
      .startTicks,
    "3456",
  );
});

test("missing VmRSS is unknown rather than a zero-valued low point", () => {
  const source = proc({ 101: { status: "Pid:\t101\n", stat: stat(101) } });
  assert.throws(
    () => sampleRendererRss([renderer(101)], source.read),
    /VmRSS.*missing or invalid/,
  );
});

test("an empty renderer set cannot pass as zero RSS", () => {
  assert.throws(
    () => sampleRendererRss([{ type: "browser", id: 1 }]),
    /No renderer processes/,
  );
});

test("a status PID mismatch is rejected", () => {
  const source = proc({ 101: { status: status(202), stat: stat(101) } });
  assert.throws(
    () => sampleRendererRss([renderer(101)], source.read),
    /status PID mismatch/,
  );
});

test("PID reuse while sampling cannot be merged into a stable process", () => {
  const source = proc({
    101: { status: status(101), stat: [stat(101, "1000"), stat(101, "2000")] },
  });
  assert.throws(
    () => sampleRendererRss([renderer(101)], source.read),
    /Process identity changed/,
  );
});

test("invalid or duplicate renderer PIDs are rejected before proc reads", () => {
  for (const id of [0, -1, 1.5, NaN, Infinity, "101", "../101"]) {
    let read = false;
    assert.throws(
      () =>
        sampleRendererRss([renderer(id)], () => {
          read = true;
          return "";
        }),
      /Invalid renderer PID/,
    );
    assert.equal(read, false);
  }
  const source = proc({ 101: { status: status(101), stat: stat(101) } });
  assert.throws(
    () => sampleRendererRss([renderer(101), renderer(101)], source.read),
    /Duplicate renderer PID/,
  );
  assert.deepEqual(source.reads, []);
});

test("missing or invalid stat identity is rejected", () => {
  for (const value of ["", stat(202), stat(101, "0"), stat(101, "invalid")]) {
    const source = proc({ 101: { status: status(101), stat: value } });
    assert.throws(
      () => sampleRendererRss([renderer(101)], source.read),
      /stat identity.*missing or invalid/,
    );
  }
});

test("unreadable proc data is surfaced instead of silently omitting RSS", () => {
  const unavailable = new Error("fixture proc read denied");
  const source = proc({ 101: { status: unavailable, stat: stat(101) } });
  assert.throws(
    () => sampleRendererRss([renderer(101)], source.read),
    /fixture proc read denied/,
  );
});

test("zero, wrong-unit and unsafe RSS values cannot create artificial minima", () => {
  for (const value of ["0 kB", "-1 kB", "1024 MB", "9007199254740992 kB"]) {
    const source = proc({
      101: { status: status(101, value), stat: stat(101) },
    });
    assert.throws(
      () => sampleRendererRss([renderer(101)], source.read),
      /VmRSS.*missing or invalid/,
    );
  }
});
