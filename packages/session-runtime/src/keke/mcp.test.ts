import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KekeMcpService, acpEntry, githubUrl } from "./mcp.js";
test("native MCP keeps unknown metadata, serializes writes and rejects corrupt stores", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keke-"));
  const path = join(dir, ".mcp.json");
  const service = new KekeMcpService({ home: dir });
  try {
    await writeFile(path, JSON.stringify({ future: true, mcpServers: {} }));
    await Promise.all([
      service.add("a", { command: "node" }),
      service.add("b", {
        type: "http",
        url: "https://example.test/mcp",
        oauth: { client_id: "fixture" },
      }),
    ]);
    assert.deepEqual(Object.keys(await service.read()).sort(), ["a", "b"]);
    assert.equal(JSON.parse(await readFile(path, "utf8")).future, true);
    assert.equal(
      (acpEntry("b", (await service.read()).b!) as any)._meta["keke.dev/oauth"]
        .client_id,
      "fixture",
    );
    await assert.rejects(service.add("a", { command: "node" }));
    await writeFile(path, "{broken");
    await assert.rejects(service.add("c", { command: "node" }));
    assert.equal(await readFile(path, "utf8"), "{broken");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Github credentials never go to lookalike, plain HTTP, userinfo or custom ports", () => {
  for (const url of [
    "https://api.githubcopilot.com.evil.test/mcp",
    "http://api.githubcopilot.com/mcp",
    "https://user@api.githubcopilot.com/mcp",
    "https://api.githubcopilot.com:8443/mcp",
  ])
    assert.throws(() => githubUrl({ type: "http", url }));
  assert.equal(
    githubUrl({ type: "http", url: "https://api.githubcopilot.com/mcp/" }),
    "https://api.githubcopilot.com/mcp/",
  );
});

test("token verification uses manual redirects and retains credentials only after success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keke-auth-"));
  let status = 401;
  const requests: {
    url: string;
    redirect: RequestRedirect | undefined;
    authorization: string | null;
  }[] = [];
  const service = new KekeMcpService({
    home: dir,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        redirect: init?.redirect,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return new Response("", { status });
    },
  });
  try {
    await service.add("github", {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      future: true,
      headers: { "X-Keep": "yes" },
    });
    await assert.rejects(
      service.authorizeGithub("github", "fixture-token"),
      (e) => !String(e).includes("fixture-token"),
    );
    assert.equal(
      (await service.read()).github?.headers?.valueOf() instanceof Object,
      true,
    );
    assert.equal(
      (await service.read()).github?.headers &&
        JSON.stringify((await service.read()).github?.headers).includes(
          "fixture-token",
        ),
      false,
    );
    status = 200;
    await service.authorizeGithub("github", "fixture-token");
    const server = (await service.read()).github!;
    assert.equal((server.headers as any).Authorization, "Bearer fixture-token");
    assert.equal((server.headers as any)["X-Keep"], "yes");
    assert.equal(server.future, true);
    assert.equal(requests[0]?.redirect, "manual");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI authorization preserves launcher prefix and passes server names as literal arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keke-cli-"));
  const fixture = join(dir, "cli.mjs"),
    log = join(dir, "calls.jsonl");
  await writeFile(
    fixture,
    `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),home:process.env.KEKE_HOME})+'\\n');process.stdout.write('signed in: yes\\n');`,
  );
  const service = new KekeMcpService({
    home: dir,
    findAgent: () => ({
      id: "keke",
      name: "Keke",
      command: process.execPath,
      args: [fixture, "agent", "stdio"],
      local: true,
    }),
  });
  try {
    const name = "-server; echo do-not-execute";
    await service.add(name, { type: "http", url: "https://example.test/mcp" });
    await service.login(name);
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((v) => JSON.parse(v));
    assert.deepEqual(
      calls.map((v) => v.args),
      [
        ["mcp", "login", "--", name],
        ["mcp", "get", "--", name],
      ],
    );
    assert.ok(calls.every((v) => v.home === dir));
    assert.equal((await service.authStatuses())[name]?.signedIn, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
