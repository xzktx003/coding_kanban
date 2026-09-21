import assert from "node:assert/strict";
import test from "node:test";

import { recoverTmuxControlSocket } from "./tmux-control-socket.js";

test("recoverTmuxControlSocket restores a missing inherited socket for the owned tmux server", async () => {
  let socketExists = false;
  const directories: Array<{ path: string; mode: number }> = [];
  const signals: Array<{ processId: number; signal: NodeJS.Signals }> = [];

  const recovered = await recoverTmuxControlSocket(
    "/tmp/tmux-1007/default,2432964,3",
    {
      pathExists: () => socketExists,
      ensureDirectory: (path, mode) => directories.push({ path, mode }),
      isOwnedTmuxServer: (processId) => processId === 2432964,
      signalServer: (processId, signal) => {
        signals.push({ processId, signal });
        socketExists = true;
      },
      wait: async () => {},
    },
  );

  assert.equal(recovered, true);
  assert.deepEqual(directories, [{ path: "/tmp/tmux-1007", mode: 0o700 }]);
  assert.deepEqual(signals, [{ processId: 2432964, signal: "SIGUSR1" }]);
});

test("recoverTmuxControlSocket refuses to signal an unverified process", async () => {
  let signaled = false;

  const recovered = await recoverTmuxControlSocket(
    "/tmp/tmux-1007/default,2432964,3",
    {
      pathExists: () => false,
      ensureDirectory: () => {
        throw new Error("must not create a directory for an unverified server");
      },
      isOwnedTmuxServer: () => false,
      signalServer: () => {
        signaled = true;
      },
      wait: async () => {},
    },
  );

  assert.equal(recovered, false);
  assert.equal(signaled, false);
});

test("recoverTmuxControlSocket ignores malformed or relative TMUX values", async () => {
  const dependencies = {
    pathExists: () => false,
    ensureDirectory: () => {
      throw new Error("must not create a directory");
    },
    isOwnedTmuxServer: () => true,
    signalServer: () => {
      throw new Error("must not signal a process");
    },
    wait: async () => {},
  };

  assert.equal(await recoverTmuxControlSocket(undefined, dependencies), false);
  assert.equal(
    await recoverTmuxControlSocket("relative.sock,2432964,3", dependencies),
    false,
  );
  assert.equal(
    await recoverTmuxControlSocket(
      "/tmp/tmux-1007/default,invalid,3",
      dependencies,
    ),
    false,
  );
});
