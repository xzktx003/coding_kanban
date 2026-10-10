import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAgent, listAgents, validateAgent } from "./agents.js";

test("discovery favors app-local tools over npx and merges user launcher IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "acp-tools-"));
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "npx"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const env = { HOME: dir, PATH: bin };
    const fallback = (await listAgents(dir, env)).find((x) => x.id === "keke")!;
    assert.equal(fallback.local, false);
    assert.equal(fallback.available, true);
    assert.deepEqual(fallback.args, [
      "-y",
      "@milisp/keke@0.1.38",
      "agent",
      "stdio",
    ]);
    const local = join(dir, "tools", "node_modules", ".bin");
    await mkdir(local, { recursive: true });
    await writeFile(join(local, "keke"), "#!/bin/sh\nexit 0\n", {
      mode: 0o700,
    });
    assert.equal(
      (await listAgents(dir, env)).find((x) => x.id === "keke")?.local,
      true,
    );
    await mkdir(join(dir, ".plux"));
    await writeFile(
      join(dir, ".plux", "acp-agents.json"),
      JSON.stringify({
        agents: {
          "Personal Claude": {
            id: "claude",
            command: process.execPath,
            args: ["fixture"],
          },
        },
      }),
    );
    const agents = await listAgents(dir, env);
    assert.equal(agents.length, 2);
    assert.equal(
      agents.find((x) => x.id === "claude")?.name,
      "Personal Claude",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("explicit preset install uses bounded npm process and application prefix, never arbitrary package", async () => {
  const dir = await mkdtemp(join(tmpdir(), "acp-install-"));
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    const trace = join(dir, "trace.json");
    await writeFile(
      join(bin, "npm"),
      `#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path');fs.writeFileSync(process.env.TRACE,JSON.stringify(process.argv.slice(2)));const root=process.argv[process.argv.indexOf('--prefix')+1];fs.mkdirSync(p.join(root,'node_modules','.bin'),{recursive:true});fs.writeFileSync(p.join(root,'node_modules','.bin','keke'),'#!/bin/sh\\nexit 0\\n',{mode:448});\n`,
      { mode: 0o700 },
    );
    const env = { HOME: dir, PATH: bin, TRACE: trace };
    const agent = await installAgent("keke", dir, env);
    assert.equal(agent.local, true);
    assert.deepEqual(JSON.parse(await readFile(trace, "utf8")), [
      "install",
      "--prefix",
      join(dir, "tools"),
      "--no-audit",
      "--no-fund",
      "@milisp/keke@0.1.38",
    ]);
    await assert.rejects(
      installAgent("evil;touch /tmp/pwn", dir, env),
      /no npm package/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("custom launcher validation rejects malformed argv/env while preserving literal shell metacharacters", () => {
  assert.throws(
    () => validateAgent({ id: "x", name: "X", command: "node", args: [null] }),
    /args/,
  );
  assert.throws(
    () =>
      validateAgent({
        id: "x",
        name: "X",
        command: "node",
        env: { "BAD=KEY": "x" },
      }),
    /env/,
  );
  const a = validateAgent({
    id: "x",
    name: "X",
    command: "node",
    args: ["$(literal)", ";literal"],
    env: { KEY: "$(literal)" },
  });
  assert.deepEqual(a.args, ["$(literal)", ";literal"]);
});
