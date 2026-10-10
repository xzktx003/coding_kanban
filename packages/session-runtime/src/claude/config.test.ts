import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeConfig } from "./config.js";

test("Claude MCP scopes merge, toggles persist, concurrent edits preserve unrelated config", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-config-"));
  try {
    const cwd = join(home, "project");
    await mkdir(cwd);
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({ keep: "value", projects: { [cwd]: {} } }),
    );
    const config = new ClaudeConfig({ HOME: home });
    await Promise.all(
      ["a", "b"].map((name) =>
        config.add(
          { name, type: "stdio", command: "node", scope: "global" },
          cwd,
        ),
      ),
    );
    await config.add(
      {
        name: "a",
        type: "http",
        url: "https://example.test/mcp",
        scope: "project",
      },
      cwd,
    );
    await config.add(
      { name: "a", type: "stdio", command: "local", scope: "local" },
      cwd,
    );
    await config.toggle("a", cwd, false);
    const a = (await config.list(cwd)).find((s) => s.name === "a");
    assert.equal(a?.scope, "local");
    assert.equal(a?.command, "local");
    assert.equal(a?.enabled, false);
    await config.remove("a", cwd, "local");
    assert.equal(
      (await config.list(cwd)).find((s) => s.name === "a")?.scope,
      "project",
    );
    assert.equal(
      JSON.parse(await readFile(join(home, ".claude.json"), "utf8")).keep,
      "value",
    );
    assert.equal((await config.list(cwd)).length, 2);
    await writeFile(join(home, ".claude.json"), "{broken");
    await assert.rejects(
      config.add(
        { name: "c", type: "stdio", command: "node", scope: "global" },
        cwd,
      ),
    );
    assert.equal(await readFile(join(home, ".claude.json"), "utf8"), "{broken");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
