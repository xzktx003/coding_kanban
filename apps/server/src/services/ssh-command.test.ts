import assert from "node:assert/strict";
import test from "node:test";

import { buildSshArgs, formatSshDestination } from "./ssh-command.js";

test("buildSshArgs leaves ssh config forwards enabled by default", () => {
  const args = buildSshArgs(
    {
      host: "117.89.254.22",
      port: 10022,
      username: "xuzk",
      identityFile: "/tmp/id_test",
    },
    {
      requestTty: true,
      remoteCommand: "exec tmux new-session -A -s test",
    },
  );

  assert.deepEqual(args, [
    "-t",
    "-p",
    "10022",
    "-i",
    "/tmp/id_test",
    "xuzk@117.89.254.22",
    "exec tmux new-session -A -s test",
  ]);
});

test("buildSshArgs supports non-interactive helper commands with batch mode", () => {
  const args = buildSshArgs(
    {
      host: "127.0.0.1",
      port: 22,
      username: "nobody",
    },
    {
      batchMode: true,
      connectTimeoutSeconds: 5,
      remoteCommand: "tmux list-panes -a",
    },
  );

  assert.deepEqual(args, [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-p",
    "22",
    "nobody@127.0.0.1",
    "tmux list-panes -a",
  ]);
});

test("buildSshArgs can still clear inherited forwards when requested", () => {
  const args = buildSshArgs(
    {
      host: "127.0.0.1",
      port: 22,
      username: "nobody",
    },
    {
      batchMode: true,
      clearAllForwardings: true,
      remoteCommand: "true",
    },
  );

  assert.deepEqual(args, [
    "-o",
    "BatchMode=yes",
    "-o",
    "ClearAllForwardings=yes",
    "-p",
    "22",
    "nobody@127.0.0.1",
    "true",
  ]);
});

test("buildSshArgs supports local port forwarding tunnels", () => {
  const args = buildSshArgs(
    {
      host: "10.30.0.24",
      port: 22,
      username: "xuzk",
    },
    {
      batchMode: true,
      connectTimeoutSeconds: 5,
      exitOnForwardFailure: true,
      localForwardings: [
        {
          bindAddress: "127.0.0.1",
          localPort: 43131,
          remoteHost: "127.0.0.1",
          remotePort: 13338,
        },
      ],
      noCommand: true,
    },
  );

  assert.deepEqual(args, [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    "127.0.0.1:43131:127.0.0.1:13338",
    "-N",
    "-p",
    "22",
    "xuzk@10.30.0.24",
  ]);
});

test("formatSshDestination rejects unsafe values", () => {
  assert.throws(
    () =>
      formatSshDestination({
        host: "safe-host",
        username: "bad\nname",
      }),
    /Invalid username/,
  );
});

test("buildSshArgs rejects option-shaped hosts and invalid ports", () => {
  assert.throws(
    () => buildSshArgs({ host: "-oProxyCommand=touch /tmp/unsafe" }),
    /Invalid host/,
  );
  assert.throws(
    () => buildSshArgs({ host: "server.example.test", port: 65_536 }),
    /Invalid port/,
  );
});
