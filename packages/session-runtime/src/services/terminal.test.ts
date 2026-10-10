import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EventHub } from "../core/events.js";
import { Terminals } from "./terminal.js";

test("real PTY preserves session IDs, Unicode output, resize, explicit stop and natural exit cleanup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-ts-pty-"));
  const hub = new EventHub();
  const terminals = new Terminals(hub, { shell: "/bin/sh", shellArgs: ["-i"] });
  t.after(async () => {
    terminals.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  });
  const sub = hub.subscribe({ agents: "terminal" });
  const started = await terminals.start({ cwd: root, cols: 80, rows: 24 });
  assert.equal(started.shell, "/bin/sh");
  terminals.resize(started.session_id, 100, 35);
  terminals.write(started.session_id, "printf '\\124\\123\\137你好\\n'\r");
  let text = "";
  const timer = setTimeout(
    () => sub.close(new Error("PTY output timeout")),
    5000,
  );
  try {
    for await (const event of sub) {
      assert.equal(event.payload.session_id, started.session_id);
      if (event.event === "terminal:data") text += event.payload.data;
      if (text.includes("TS_你好")) break;
    }
  } finally {
    clearTimeout(timer);
  }
  assert.match(text, /TS_你好/);
  const exited = hub.subscribe({ agents: "terminal" });
  terminals.write(started.session_id, "exit\r");
  const exitTimer = setTimeout(
    () => exited.close(new Error("PTY exit timeout")),
    5000,
  );
  try {
    for await (const event of exited)
      if (event.event === "terminal:exit") break;
  } finally {
    clearTimeout(exitTimer);
  }
  assert.equal(terminals.count, 0);
  const another = await terminals.start({ cwd: root });
  assert.equal(terminals.count, 1);
  terminals.stop(another.session_id);
  assert.equal(terminals.count, 0);
  assert.throws(
    () => terminals.write("unowned-session", "exit\r"),
    /not found/,
  );
  await assert.rejects(terminals.start({ cwd: root, cols: -1 }), /cols/);
});
