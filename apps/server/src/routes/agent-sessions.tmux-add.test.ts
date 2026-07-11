import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildServer } from "../app.js";
import { resolveTmuxBinary } from "../services/runtime-compat.js";

const TMUX_BINARY = resolveTmuxBinary();

function runTmux(args: string[]): string {
  return execFileSync(TMUX_BINARY, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function firstPaneId(sessionName: string): string {
  return runTmux(["list-panes", "-t", sessionName, "-F", "#{pane_id}"])
    .split("\n")
    .find(Boolean) as string;
}

function paneFormat(paneId: string, format: string): string {
  return runTmux(["display-message", "-p", "-t", paneId, format]);
}

function killTmuxSession(sessionName: string): void {
  try {
    execFileSync(TMUX_BINARY, ["kill-session", "-t", sessionName], {
      stdio: "ignore",
    });
  } catch {
    // ignore cleanup failures
  }
}

async function waitForFileText(
  filePath: string,
  expectedText: string,
  timeoutMs = 3_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      const text = readFileSync(filePath, "utf8");
      if (text === expectedText) {
        return text;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const actualText = existsSync(filePath)
    ? readFileSync(filePath, "utf8")
    : "<missing>";
  throw new Error(
    `file ${filePath} did not become ${expectedText}; actual=${actualText}`,
  );
}

function waitForTerminalMarker(
  terminalUrl: string,
  marker: string,
  timeoutMs = 3_000,
): Promise<{ kind: "message"; payload: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(terminalUrl);
    const timeoutId = setTimeout(() => {
      socket.close();
      reject(new Error(`terminal websocket did not receive marker ${marker}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.close();
    };

    socket.addEventListener("message", async (event) => {
      const payload =
        typeof event.data === "string" ? event.data : await event.data.text();

      if (payload.includes(marker)) {
        cleanup();
        resolve({ kind: "message", payload });
      }
    });

    socket.addEventListener("close", (event) => {
      clearTimeout(timeoutId);
      reject(
        new Error(
          `terminal websocket closed before marker: ${event.code} ${event.reason}`,
        ),
      );
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("terminal websocket connection failed"));
    });
  });
}

test("POST /api/agent-discovery/tmux/add creates a live terminal session for the added tmux card", async () => {
  const { app } = buildServer();
  const sessionName = `tmux-add-live-${Date.now()}`;
  const marker = `TMUX_ADD_LIVE_${Date.now()}`;
  let agentSessionId: string | undefined;

  killTmuxSession(sessionName);

  runTmux([
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    process.cwd(),
    `sh -lc 'printf "${marker}\\n"; sleep 30'`,
  ]);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-discovery/tmux/add`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tmuxSession: sessionName,
        displayName: sessionName,
        workingDirectory: process.cwd(),
        agentKind: "shell",
        interactionState: "running",
      }),
    });

    assert.equal(response.status, 201);

    const payload = (await response.json()) as { id: string };
    agentSessionId = payload.id;

    const terminalMessage = await waitForTerminalMarker(
      `${terminalUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
      marker,
    );

    assert.match(terminalMessage.payload, new RegExp(marker));
  } finally {
    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
    killTmuxSession(sessionName);
  }
});

test("POST /api/agent-discovery/tmux/add can attach to a discovered tmux pane without exiting immediately", async () => {
  const { app } = buildServer();
  const sessionName = `tmux-add-pane-${Date.now()}`;
  const marker = `TMUX_ADD_PANE_${Date.now()}`;
  let agentSessionId: string | undefined;

  killTmuxSession(sessionName);

  runTmux([
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    process.cwd(),
    `sh -lc 'printf "${marker}\\n"; sleep 30'`,
  ]);

  const tmuxPane = firstPaneId(sessionName);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-discovery/tmux/add`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tmuxSession: sessionName,
        tmuxPane,
        displayName: sessionName,
        workingDirectory: process.cwd(),
        agentKind: "copilot",
        interactionState: "running",
      }),
    });

    assert.equal(response.status, 201);

    const payload = (await response.json()) as { id: string };
    agentSessionId = payload.id;

    const terminalMessage = await waitForTerminalMarker(
      `${terminalUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
      marker,
    );

    assert.match(terminalMessage.payload, new RegExp(marker));
  } finally {
    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
    killTmuxSession(sessionName);
  }
});

test("POST /api/agent-sessions/:id/stdin delivers every mobile shortcut to a local tmux pane", async () => {
  const { app } = buildServer();
  const sessionName = `tmux-mobile-keys-${Date.now()}`;
  const capturePath = join(tmpdir(), `${sessionName}.hex`);
  const readyMarker = `TMUX_MOBILE_KEYS_READY_${Date.now()}`;
  const mobileShortcutInputs = [
    "\x03",
    "\x1b",
    "\x7f",
    "\t",
    "\x1b[Z",
    "\r",
    "\x1b[13;2u",
    "\x1b[13;5u",
    "\x1b[A",
    "\x1b[B",
    "\x1b[D",
    "\x1b[C",
    "\x0c",
    "\x1a",
  ];
  const expectedHex = Buffer.from(mobileShortcutInputs.join("")).toString(
    "hex",
  );
  let agentSessionId: string | undefined;

  killTmuxSession(sessionName);
  rmSync(capturePath, { force: true });

  runTmux([
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    process.cwd(),
    [
      "node -e ",
      JSON.stringify(
        [
          "const fs = require('node:fs');",
          "process.stdin.setRawMode(true);",
          "process.stdin.resume();",
          `const capturePath = ${JSON.stringify(capturePath)};`,
          `const expectedLength = Buffer.from(${JSON.stringify(mobileShortcutInputs.join(""))}).length;`,
          `console.log(${JSON.stringify(readyMarker)});`,
          "const chunks = [];",
          "process.stdin.on('data', (chunk) => {",
          "chunks.push(chunk);",
          "const input = Buffer.concat(chunks);",
          "fs.writeFileSync(capturePath, input.toString('hex'));",
          "if (input.length >= expectedLength) process.exit(0);",
          "});",
        ].join(""),
      ),
    ].join(""),
  ]);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const addResponse = await fetch(`${baseUrl}/api/agent-discovery/tmux/add`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tmuxSession: sessionName,
        displayName: sessionName,
        workingDirectory: process.cwd(),
        agentKind: "shell",
        interactionState: "running",
      }),
    });

    assert.equal(addResponse.status, 201);
    const payload = (await addResponse.json()) as { id: string };
    agentSessionId = payload.id;

    await waitForTerminalMarker(
      `${terminalUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
      readyMarker,
    );

    for (const input of mobileShortcutInputs) {
      const stdinResponse: Response = await fetch(
        `${baseUrl}/api/agent-sessions/${agentSessionId}/stdin`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ input }),
        },
      );

      assert.equal(stdinResponse.status, 200);
    }

    assert.equal(await waitForFileText(capturePath, expectedHex), expectedHex);
  } finally {
    rmSync(capturePath, { force: true });

    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
    killTmuxSession(sessionName);
  }
});

test("PATCH /api/agent-sessions/:id renames the tmux session and pane title together", async () => {
  const { app } = buildServer();
  const sessionName = `tmux-rename-${Date.now()}`;
  const renamedSession = `tmux:renamed-${Date.now()}`;
  const renamedTmuxSession = renamedSession.replace(/:/g, "_");
  const secondRenamedSession = `tmux-renamed-again-${Date.now()}`;
  let agentSessionId: string | undefined;

  killTmuxSession(sessionName);
  killTmuxSession(renamedSession);
  killTmuxSession(renamedTmuxSession);
  killTmuxSession(secondRenamedSession);

  runTmux([
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    process.cwd(),
    `sh -lc 'sleep 30'`,
  ]);

  const tmuxPane = firstPaneId(sessionName);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const addResponse = await fetch(`${baseUrl}/api/agent-discovery/tmux/add`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tmuxSession: sessionName,
        tmuxPane,
        displayName: sessionName,
        workingDirectory: process.cwd(),
        agentKind: "shell",
      }),
    });

    assert.equal(addResponse.status, 201);
    const addedSession = (await addResponse.json()) as { id: string };
    agentSessionId = addedSession.id;

    const renameResponse = await fetch(
      `${baseUrl}/api/agent-sessions/${agentSessionId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: renamedSession,
        }),
      },
    );

    assert.equal(renameResponse.status, 200);
    const renamed = (await renameResponse.json()) as {
      displayName: string;
      workspaceId: string;
      transportRef?: { tmuxSession?: string };
    };

    assert.equal(renamed.displayName, renamedSession);
    assert.equal(renamed.workspaceId, renamedSession);
    assert.equal(renamed.transportRef?.tmuxSession, renamedTmuxSession);
    assert.equal(paneFormat(tmuxPane, "#{session_name}"), renamedTmuxSession);
    assert.equal(paneFormat(tmuxPane, "#{pane_title}"), renamedSession);

    const secondRenameResponse = await fetch(
      `${baseUrl}/api/agent-sessions/${agentSessionId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: secondRenamedSession,
        }),
      },
    );

    assert.equal(secondRenameResponse.status, 200);
    const secondRenamed = (await secondRenameResponse.json()) as {
      displayName: string;
      workspaceId: string;
      transportRef?: { tmuxSession?: string };
    };

    assert.equal(secondRenamed.displayName, secondRenamedSession);
    assert.equal(secondRenamed.workspaceId, secondRenamedSession);
    assert.equal(secondRenamed.transportRef?.tmuxSession, secondRenamedSession);
    assert.equal(paneFormat(tmuxPane, "#{session_name}"), secondRenamedSession);
    assert.equal(paneFormat(tmuxPane, "#{pane_title}"), secondRenamedSession);
  } finally {
    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
    killTmuxSession(sessionName);
    killTmuxSession(renamedSession);
    killTmuxSession(renamedTmuxSession);
    killTmuxSession(secondRenamedSession);
  }
});
