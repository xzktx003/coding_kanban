import assert from "node:assert/strict";
import test from "node:test";

import { parseSshConfigContent } from "./ssh-config-parser.js";

test("lists one preset per SSH Host directive while keeping SSH aliases usable", () => {
  const hosts = parseSshConfigContent(`
Host 10.64.35.29 moe-remote-35-29
    HostName 10.64.35.29
    User zukang.xu
    Port 22
    IdentityFile ~/.ssh/id_ed25519_10_64_35_29

Host *.example.test fallback
    HostName fallback.example.test
`);

  assert.deepEqual(
    hosts.map(({ name, host, username, port }) => ({
      name,
      host,
      username,
      port,
    })),
    [
      {
        name: "10.64.35.29",
        host: "10.64.35.29",
        username: "zukang.xu",
        port: 22,
      },
      {
        name: "fallback",
        host: "fallback.example.test",
        username: undefined,
        port: 22,
      },
    ],
  );
});
