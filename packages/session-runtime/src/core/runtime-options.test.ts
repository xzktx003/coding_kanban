import test from "node:test";
import assert from "node:assert/strict";
import { parseRuntimeArgs, resolveRuntimeOptions } from "./runtime-options.js";

test("runtime accepts legacy port aliases and configured CORS origins", () => {
  assert.deepEqual(
    parseRuntimeArgs(
      [
        "--web-port=8501",
        "--allow-origin",
        "https://one.example",
        "--allow-origin=https://two.example",
      ],
      {
        VITE_WEB_PORT: "8500",
        CODEXIA_ALLOWED_ORIGINS:
          " https://configured.example , ,https://one.example ",
      },
    ),
    {
      port: 8501,
      remote: false,
      allowedOrigins: [
        "https://configured.example",
        "https://one.example",
        "https://two.example",
      ],
    },
  );
  assert.equal(parseRuntimeArgs(["--port", "0"], {}).port, 0);
  assert.equal(parseRuntimeArgs(["--web-port", "8502"], {}).port, 8502);
  assert.equal(parseRuntimeArgs([], { VITE_WEB_PORT: "8503" }).port, 8503);
  assert.equal(parseRuntimeArgs([], { VITE_WEB_PORT: "invalid" }).port, 7420);
  for (const args of [
    ["--port", "65536"],
    ["--web-port", "-1"],
    ["--port"],
    ["--allow-origin"],
  ])
    assert.throws(() => parseRuntimeArgs(args, {}));
});
test("only explicit remote mode discovers/binds Tailscale and missing identity stays on loopback", async () => {
  let calls = 0;
  const detect = async () => {
    calls++;
    return { dns_name: "workstation.tail.ts.net", ipv4: "100.100.1.2" };
  };
  assert.equal(
    (await resolveRuntimeOptions(["--port", "7421"], {}, detect)).host,
    "127.0.0.1",
  );
  assert.equal(calls, 0);
  const remote = await resolveRuntimeOptions(
    ["--remote", "--port", "7421"],
    {},
    detect,
  );
  assert.equal(remote.host, "100.100.1.2");
  assert.equal(calls, 1);
  assert.equal(
    (await resolveRuntimeOptions(["--remote"], {}, async () => null)).host,
    "127.0.0.1",
  );
  await assert.rejects(
    resolveRuntimeOptions(["--remote"], {}, async () => ({
      dns_name: "bad",
      ipv4: "0.0.0.0",
    })),
    /Tailscale/,
  );
});
