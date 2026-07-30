import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VSCodeDrawer } from "./VSCodeDrawer.js";

const cachedResponse = {
  provider: "code-server",
  reused: true,
  url: "https://kanban.example.test/vscode/?folder=%2Ftmp%2Fproject",
  workingDirectory: "/tmp/project",
};

describe("VSCodeDrawer", () => {
  it("delegates browser clipboard permissions to the embedded editor", () => {
    const storage = new Map<string, string>([
      ["vscode-web-state:session-a", JSON.stringify(cachedResponse)],
    ]);
    const originalLocalStorage = globalThis.localStorage;
    const localStorage: Storage = {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    globalThis.localStorage = localStorage;

    try {
      const markup = renderToStaticMarkup(
        createElement(VSCodeDrawer, {
          active: true,
          agentSessionId: "session-a",
          displayName: "Clipboard Test",
          open: true,
        }),
      );

      assert.match(markup, /allow="clipboard-read; clipboard-write"/);
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });
});
