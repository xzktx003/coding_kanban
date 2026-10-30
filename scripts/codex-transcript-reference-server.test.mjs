import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("current transcript reference exposes only read-only fixtures and unchanged pinned assets", async () => {
  const child = spawn(process.execPath, ["scripts/codex-goal-reference-server.mjs", "--host", "0.0.0.0", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  const stopped = once(child, "exit");
  let output = "";
  const identity = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", bytes => { output += bytes; if (output.includes("\n")) { try { resolve(JSON.parse(output.split("\n")[0])); } catch (error) { reject(error); } } });
    child.once("exit", code => reject(new Error(`fixture exited ${code}`)));
  });
  try {
    assert.equal(identity.version, "26.51007.21434");
    const base = new URL(identity.urls[0]).origin;
    const html = await fetch(`${base}/native-transcript.html`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /native-transcript-reference\.js/);
    assert.equal((await fetch(`${base}/native-transcript-reference.js`)).status, 200);
    assert.equal((await fetch(`${base}/native-transcript.html`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    const name = "sites-end-resource-733bd1c6da06.js";
    const bytes = Buffer.from(await (await fetch(`${base}/assets/${name}`)).arrayBuffer());
    const original = await readFile(`third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets/${name}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(original).digest("hex"));
  } finally { child.kill("SIGTERM"); await stopped; }
});
