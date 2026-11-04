import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  claimTerminalCompletionChime,
  parseAgentCompletionChime,
  readTaskCompleteBeepMode,
  resetTerminalCompletionChimeClaims,
  shouldPlayTerminalCompletionChime,
} from "./agent-completion-chime.js";

class MemoryStorage {
  constructor(private readonly values = new Map<string, string>()) {}

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

afterEach(() => {
  resetTerminalCompletionChimeClaims();
});

describe("terminal completion chimes", () => {
  it("accepts only a complete structured chime", () => {
    assert.deepEqual(
      parseAgentCompletionChime(
        JSON.stringify({
          type: "completion-chime",
          payload: {
            sessionId: "session-1",
            completionId: "turn-1",
            agentKind: "codex",
          },
        }),
      ),
      { sessionId: "session-1", completionId: "turn-1", agentKind: "codex" },
    );
    assert.equal(
      parseAgentCompletionChime(
        JSON.stringify({ type: "snapshot", payload: { items: [] } }),
      ),
      null,
    );
    assert.equal(
      parseAgentCompletionChime(
        JSON.stringify({
          type: "completion-chime",
          payload: { sessionId: "", completionId: "turn-1", agentKind: "codex" },
        }),
      ),
      null,
    );
    assert.equal(parseAgentCompletionChime("{"), null);
  });

  it("reads the session beep preference and defaults to always", () => {
    assert.equal(readTaskCompleteBeepMode(new MemoryStorage()), "always");
    assert.equal(
      readTaskCompleteBeepMode(
        new MemoryStorage(
          new Map([
            [
              "kanban.session.settings-storage",
              JSON.stringify({ state: { enableTaskCompleteBeep: "never" } }),
            ],
          ]),
        ),
      ),
      "never",
    );
    assert.equal(
      readTaskCompleteBeepMode(
        new MemoryStorage(
          new Map([["kanban.session.settings-storage", "{"]]),
        ),
      ),
      "always",
    );
  });

  it("plays only for an active terminal and the selected focus mode", () => {
    const focused = { hidden: false, focused: true };
    const away = { hidden: true, focused: false };
    assert.equal(
      shouldPlayTerminalCompletionChime("always", true, focused),
      true,
    );
    assert.equal(
      shouldPlayTerminalCompletionChime("always", false, focused),
      false,
    );
    assert.equal(
      shouldPlayTerminalCompletionChime("never", true, away),
      false,
    );
    assert.equal(
      shouldPlayTerminalCompletionChime("unfocused", true, focused),
      false,
    );
    assert.equal(
      shouldPlayTerminalCompletionChime("unfocused", true, away),
      true,
    );
  });

  it("claims each completion once", () => {
    assert.equal(claimTerminalCompletionChime("session-1", "turn-1"), true);
    assert.equal(claimTerminalCompletionChime("session-1", "turn-1"), false);
    assert.equal(claimTerminalCompletionChime("session-1", "turn-2"), true);
  });
});
