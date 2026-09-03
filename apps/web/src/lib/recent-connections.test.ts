import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

// Polyfill localStorage for Node.js test env
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  get length() {
    return store.size;
  },
  key: (i: number) => [...store.keys()][i] ?? null,
};

// @ts-ignore - polyfill for test
globalThis.localStorage = mockLocalStorage;

import {
  loadRecentConnections,
  saveRecentConnection,
  clearRecentConnections,
} from "./recent-connections.js";

describe("recent-connections", () => {
  beforeEach(() => {
    store.clear();
  });

  it("returns empty array when no connections saved", () => {
    const result = loadRecentConnections();
    assert.deepEqual(result, []);
  });

  it("saves and loads a connection", () => {
    saveRecentConnection({
      hostName: "my-server",
      hostId: "192.168.1.1",
      sessionName: "dev-tmux",
      workingDirectory: "~/code",
    });

    const result = loadRecentConnections();
    assert.equal(result.length, 1);
    assert.equal(result[0].hostName, "my-server");
    assert.equal(result[0].sessionName, "dev-tmux");
    assert.equal(result[0].workingDirectory, "~/code");
    assert.equal(typeof result[0].connectedAt, "string");
  });

  it("deduplicates by hostId + sessionName", () => {
    saveRecentConnection({
      hostName: "s1",
      hostId: "h1",
      sessionName: "t1",
      workingDirectory: "~/a",
    });
    saveRecentConnection({
      hostName: "s1",
      hostId: "h1",
      sessionName: "t1",
      workingDirectory: "~/b",
    });

    const result = loadRecentConnections();
    assert.equal(result.length, 1);
    assert.equal(result[0].workingDirectory, "~/b");
  });

  it("caps at 8 recent connections", () => {
    for (let i = 0; i < 10; i++) {
      saveRecentConnection({
        hostName: `h${i}`,
        hostId: `hid${i}`,
        sessionName: `t${i}`,
        workingDirectory: `~/${i}`,
      });
    }
    const result = loadRecentConnections();
    assert.equal(result.length, 8);
    assert.equal(result[0].hostName, "h9");
    assert.equal(result[7].hostName, "h2");
  });

  it("clears all connections", () => {
    saveRecentConnection({
      hostName: "s1",
      hostId: "h1",
      sessionName: "t1",
      workingDirectory: "~",
    });
    clearRecentConnections();
    assert.deepEqual(loadRecentConnections(), []);
  });
});
