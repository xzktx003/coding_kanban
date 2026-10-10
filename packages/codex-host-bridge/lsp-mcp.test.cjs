const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handle, execute } = require("./lsp-mcp.cjs");
test("optional MCP advertises a real read-only language tool and preserves unavailable capability", async () => {
  const initialize = await handle({
    method: "initialize",
    params: { protocolVersion: "2025-03-26" },
  });
  assert.equal(initialize.protocolVersion, "2025-03-26");
  assert.equal(
    (await handle({ method: "tools/list" })).tools[0].name,
    "vscode_find_definitions",
  );
  const success = await handle(
    {
      method: "tools/call",
      params: {
        name: "vscode_find_definitions",
        arguments: { path: "a.ts", line: 2, column: 4 },
      },
    },
    async (args) => ({ locations: [{ path: args.path, line: 1, column: 1 }] }),
  );
  assert.equal(JSON.parse(success.content[0].text).locations[0].line, 1);
  const unavailable = await handle(
    {
      method: "tools/call",
      params: { name: "vscode_find_definitions", arguments: {} },
    },
    (args) => execute(args, {}),
  );
  assert.equal(unavailable.isError, true);
  assert.match(unavailable.content[0].text, /未配置/);
});
