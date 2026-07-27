import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildServer } from "../app.js";
import { resolveTmuxBinary } from "../services/runtime-compat.js";

const TMUX_BINARY = resolveTmuxBinary();
const INTERACTIVE_FILTER_SHELL_COMMAND =
  "printf '__READY__\\n'; exec /bin/sh -i";

function runTmux(args: string[]): string {
  return execFileSync(TMUX_BINARY, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function killTmuxSession(sessionName: string): void {
  try {
    execFileSync(TMUX_BINARY, ["kill-session", "-t", sessionName], {
      stdio: "ignore",
    });
  } catch {
    // Ignore cleanup failures.
  }
}

interface WaitForTerminalTextResult {
  close: () => void;
  getBuffer: () => string;
  send: (payload: string) => void;
  waitFor: (marker: string, timeoutMs?: number) => Promise<void>;
}

async function openTerminal(
  terminalUrl: string,
): Promise<WaitForTerminalTextResult> {
  const socket = new WebSocket(terminalUrl);
  let buffer = "";

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("terminal websocket did not open in time"));
    }, 3_000);

    socket.addEventListener("open", () => {
      clearTimeout(timeoutId);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("terminal websocket connection failed"));
    });
  });

  socket.addEventListener("message", async (event) => {
    const payload =
      typeof event.data === "string" ? event.data : await event.data.text();

    try {
      const parsed = JSON.parse(payload) as {
        __agentOrchestrator?: string;
        data?: string;
      };

      if (parsed.__agentOrchestrator === "terminal-control") {
        if (typeof parsed.data === "string") {
          buffer += parsed.data;
        }
        return;
      }
    } catch {
      // plain terminal payload
    }

    buffer += payload;
  });

  return {
    close: () => socket.close(),
    getBuffer: () => buffer,
    send: (payload: string) => socket.send(payload),
    waitFor: (marker: string, timeoutMs = 3_000) =>
      new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;

        const poll = () => {
          if (buffer.includes(marker)) {
            resolve();
            return;
          }

          if (Date.now() >= deadline) {
            reject(
              new Error(
                `terminal websocket did not receive marker ${marker}; buffer=${JSON.stringify(buffer)}`,
              ),
            );
            return;
          }

          setTimeout(poll, 25);
        };

        poll();
      }),
  };
}

test("terminal websocket forwards primary device-attribute replies so TUIs can finish their capability handshake", async () => {
  const { app } = buildServer();
  let agentSessionId: string | undefined;
  let terminal: WaitForTerminalTextResult | undefined;

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalBaseUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/agent-launch/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "default",
        displayName: "terminal-filter",
        agentKind: "shell",
        workingDirectory: process.cwd(),
        command: INTERACTIVE_FILTER_SHELL_COMMAND,
      }),
    });

    assert.equal(createRes.status, 201);

    const payload = (await createRes.json()) as { id: string };
    agentSessionId = payload.id;

    terminal = await openTerminal(
      `${terminalBaseUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );
    await terminal.waitFor("__READY__");

    terminal.send("\u001b[?1;2cprintf '__FILTER_OK__\\n'\n");
    await terminal.waitFor("__FILTER_OK__");

    const output = terminal.getBuffer();
    assert.match(output, /__FILTER_OK__/);
    assert.match(output, /\?1;2c/);
  } finally {
    terminal?.close();

    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
  }
});

test("terminal websocket sanitizes active PTY replay mode toggles before remounting xterm", async () => {
  const { app } = buildServer();
  let agentSessionId: string | undefined;
  let terminal: WaitForTerminalTextResult | undefined;

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalBaseUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/agent-launch/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "default",
        displayName: "terminal-replay-mode-filter",
        agentKind: "shell",
        workingDirectory: process.cwd(),
        command:
          "node ../../scripts/mock-terminal-agent.mjs mode-replay; sleep 3",
      }),
    });

    assert.equal(createRes.status, 201);

    const payload = (await createRes.json()) as { id: string };
    agentSessionId = payload.id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3_000;

      const poll = async () => {
        const detailResponse = await fetch(
          `${baseUrl}/api/agent-sessions/${agentSessionId}`,
        );
        const detail = (await detailResponse.json()) as {
          outputEntries?: Array<{ text?: string }>;
        };
        const output = detail.outputEntries
          ?.map((entry) => entry.text ?? "")
          .join("");

        if (output?.includes("__MODE_REPLAY_READY__")) {
          resolve();
          return;
        }

        if (Date.now() >= deadline) {
          reject(new Error("PTY output did not reach session detail in time"));
          return;
        }

        setTimeout(poll, 25);
      };

      void poll();
    });

    terminal = await openTerminal(
      `${terminalBaseUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );
    await terminal.waitFor(
      "beforefocuscursormousepastekeypadnormal__MODE_REPLAY_READY__",
    );

    const output = terminal.getBuffer();
    assert.match(
      output,
      /beforefocuscursormousepastekeypadnormal__MODE_REPLAY_READY__/,
    );
    assert.doesNotMatch(output, /\u001b\[\?1004h/);
    assert.doesNotMatch(output, /\u001b\[\?1h/);
    assert.doesNotMatch(output, /\u001b\[\?1000;1006h/);
    assert.doesNotMatch(output, /\u001b\[\?2004h/);
    assert.doesNotMatch(output, /\u001b[=>]/);
  } finally {
    terminal?.close();

    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
  }
});

test("terminal websocket drops focus reports for local tmux sessions so they do not become prompt text", async () => {
  const { app } = buildServer();
  const sessionName = `tmux-focus-report-${Date.now()}`;
  const readyMarker = `TMUX_FOCUS_READY_${Date.now()}`;
  const inputMarker = `TMUX_FOCUS_INPUT_${Date.now()}`;
  let agentSessionId: string | undefined;
  let terminal: WaitForTerminalTextResult | undefined;

  killTmuxSession(sessionName);

  runTmux([
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    process.cwd(),
    `sh -lc 'printf "${readyMarker}\\n"; exec sh'`,
  ]);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalBaseUrl = `ws://127.0.0.1:${address.port}`;

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

    terminal = await openTerminal(
      `${terminalBaseUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );
    await terminal.waitFor(readyMarker);

    terminal.send("\u001b[I");
    terminal.send(`printf '${inputMarker}\\n'\r`);
    await terminal.waitFor(inputMarker);

    assert.doesNotMatch(terminal.getBuffer(), /\[I/);
  } finally {
    terminal?.close();

    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
    killTmuxSession(sessionName);
  }
});

test("terminal websocket keeps split bracketed paste chunks literal for local tmux sessions", async () => {
  const { app } = buildServer();
  const sessionName = `tmux-split-bracketed-paste-${Date.now()}`;
  const readyMarker = `TMUX_SPLIT_PASTE_READY_${Date.now()}`;
  const pasteMarker = `__SPLIT_PASTE_END_${Date.now()}__`;
  const capturePath = join(
    tmpdir(),
    `coding-kanban-split-paste-${Date.now()}.hex`,
  );
  let agentSessionId: string | undefined;
  let terminal: WaitForTerminalTextResult | undefined;

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
          `console.log(${JSON.stringify(readyMarker)});`,
          "const chunks = [];",
          "process.stdin.on('data', (chunk) => {",
          "chunks.push(chunk);",
          "const input = Buffer.concat(chunks);",
          `if (input.includes(Buffer.from(${JSON.stringify(pasteMarker)}))) {`,
          `fs.writeFileSync(${JSON.stringify(capturePath)}, input.toString('hex'));`,
          "}",
          "});",
        ].join(""),
      ),
    ].join(""),
  ]);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalBaseUrl = `ws://127.0.0.1:${address.port}`;

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

    terminal = await openTerminal(
      `${terminalBaseUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );
    await terminal.waitFor(readyMarker);

    terminal.send("\u001b[200~first pasted line\r");
    terminal.send("second pasted line\r");
    terminal.send(`third pasted line ${pasteMarker}\u001b[201~`);

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3_000;

      const poll = () => {
        if (existsSync(capturePath)) {
          resolve();
          return;
        }

        if (Date.now() >= deadline) {
          reject(new Error("split bracketed paste capture was not written"));
          return;
        }

        setTimeout(poll, 25);
      };

      poll();
    });

    const capturedHex = readFileSync(capturePath, "utf8");
    const expectedHex = Buffer.from(
      `\u001b[200~first pasted line\rsecond pasted line\rthird pasted line ${pasteMarker}\u001b[201~`,
    ).toString("hex");

    assert.equal(capturedHex, expectedHex);
  } finally {
    terminal?.close();
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

test("terminal websocket strips secondary device-attribute replies so shell prompts do not echo terminal version noise", async () => {
  const { app } = buildServer();
  let agentSessionId: string | undefined;
  let terminal: WaitForTerminalTextResult | undefined;

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalBaseUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/agent-launch/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "default",
        displayName: "terminal-secondary-da-filter",
        agentKind: "shell",
        workingDirectory: process.cwd(),
        command: INTERACTIVE_FILTER_SHELL_COMMAND,
      }),
    });

    assert.equal(createRes.status, 201);

    const payload = (await createRes.json()) as { id: string };
    agentSessionId = payload.id;

    terminal = await openTerminal(
      `${terminalBaseUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );
    await terminal.waitFor("__READY__");

    terminal.send("\u001b[>0;276;0cprintf '__FILTER_OK__\\n'\n");
    await terminal.waitFor("__FILTER_OK__");

    const output = terminal.getBuffer();
    assert.match(output, /__FILTER_OK__/);
    assert.doesNotMatch(output, /0;276;0c/);
  } finally {
    terminal?.close();

    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
  }
});

test("terminal websocket strips OSC color-query replies so rgb payload noise never echoes into the terminal", async () => {
  const { app } = buildServer();
  let agentSessionId: string | undefined;
  let terminal: WaitForTerminalTextResult | undefined;

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();

  assert.ok(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const terminalBaseUrl = `ws://127.0.0.1:${address.port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/agent-launch/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "default",
        displayName: "terminal-osc-color-filter",
        agentKind: "shell",
        workingDirectory: process.cwd(),
        command: INTERACTIVE_FILTER_SHELL_COMMAND,
      }),
    });

    assert.equal(createRes.status, 201);

    const payload = (await createRes.json()) as { id: string };
    agentSessionId = payload.id;

    terminal = await openTerminal(
      `${terminalBaseUrl}/ws/agent-sessions/${agentSessionId}/terminal`,
    );
    await terminal.waitFor("__READY__");

    terminal.send(
      "\u001b]11;rgb:0e0e/1212/1717\u0007\u001b]10;rgb:f4f4/f1f1/eaea\u0007\u001b]4;0;rgb:0000/0000/0000\u0007printf '__FILTER_OK__\\n'\n",
    );
    await terminal.waitFor("__FILTER_OK__");

    const output = terminal.getBuffer();
    assert.match(output, /__FILTER_OK__/);
    assert.doesNotMatch(output, /rgb:/);
  } finally {
    terminal?.close();

    if (agentSessionId) {
      await fetch(`${baseUrl}/api/agent-sessions/${agentSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    await app.close();
  }
});
