import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_CACHED_VSCODE_IFRAMES,
  VSCODE_IFRAME_CACHE_MODE_STORAGE_KEY,
  formatVsCodeIframeCacheMode,
  loadVsCodeIframeCacheMode,
  parseVsCodeIframeCacheMode,
  releaseVsCodeCacheSessionIds,
  resolveLightweightTerminalPreviewForVsCodeCacheMode,
  resolveRenderedVsCodeSessionIds,
  saveVsCodeIframeCacheMode,
  toggleVsCodeIframeCacheMode,
  touchVsCodeCacheSessionIds,
} from "./vscode-cache.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("touchVsCodeCacheSessionIds", () => {
  it("keeps the existing render order when revisiting a cached session", () => {
    const result = touchVsCodeCacheSessionIds(
      ["session-a", "session-b"],
      "session-a",
      8,
    );

    assert.deepEqual(result, ["session-a", "session-b"]);
  });

  it("caps remembered iframe sessions to the requested maximum", () => {
    const result = touchVsCodeCacheSessionIds(
      [
        "session-a",
        "session-b",
        "session-c",
        "session-d",
        "session-e",
        "session-f",
        "session-g",
        "session-h",
      ],
      "session-i",
      8,
    );

    assert.deepEqual(result, [
      "session-b",
      "session-c",
      "session-d",
      "session-e",
      "session-f",
      "session-g",
      "session-h",
      "session-i",
    ]);
  });
});

describe("VS Code iframe cache mode", () => {
  it("caps preserve-state mode at three heavyweight editor iframes", () => {
    assert.equal(MAX_CACHED_VSCODE_IFRAMES, 3);
  });

  it("defaults to memory-saving mode unless preserve-state was explicitly saved", () => {
    assert.equal(parseVsCodeIframeCacheMode(null), "memory-saving");
    assert.equal(parseVsCodeIframeCacheMode("memory-saving"), "memory-saving");
    assert.equal(parseVsCodeIframeCacheMode("unexpected"), "memory-saving");
    assert.equal(
      parseVsCodeIframeCacheMode("preserve-state"),
      "preserve-state",
    );
  });

  it("formats, persists, and toggles cache modes", () => {
    const storage = new MemoryStorage();

    saveVsCodeIframeCacheMode("preserve-state", storage);
    assert.equal(
      storage.getItem(VSCODE_IFRAME_CACHE_MODE_STORAGE_KEY),
      "preserve-state",
    );
    assert.equal(loadVsCodeIframeCacheMode(storage), "preserve-state");
    assert.equal(formatVsCodeIframeCacheMode("memory-saving"), "memory-saving");
    assert.equal(
      toggleVsCodeIframeCacheMode("memory-saving"),
      "preserve-state",
    );
    assert.equal(
      toggleVsCodeIframeCacheMode("preserve-state"),
      "memory-saving",
    );
  });

  it("pairs VS Code cache profiles with the matching terminal preview fidelity", () => {
    assert.equal(
      resolveLightweightTerminalPreviewForVsCodeCacheMode("memory-saving"),
      true,
    );
    assert.equal(
      resolveLightweightTerminalPreviewForVsCodeCacheMode("preserve-state"),
      false,
    );
  });
});

describe("resolveRenderedVsCodeSessionIds", () => {
  it("renders only the active iframe in memory-saving mode", () => {
    assert.deepEqual(
      resolveRenderedVsCodeSessionIds({
        activeSessionId: "active",
        cachedSessionIds: ["old-a", "old-b"],
        maxCachedIframes: 6,
        mode: "memory-saving",
      }),
      ["active"],
    );

    assert.deepEqual(
      resolveRenderedVsCodeSessionIds({
        activeSessionId: null,
        cachedSessionIds: ["old-a", "old-b"],
        maxCachedIframes: 6,
        mode: "memory-saving",
      }),
      [],
    );
  });

  it("keeps recent cached iframes in preserve-state mode", () => {
    assert.deepEqual(
      resolveRenderedVsCodeSessionIds({
        activeSessionId: "session-h",
        cachedSessionIds: [
          "session-a",
          "session-b",
          "session-c",
          "session-d",
          "session-e",
          "session-f",
          "session-g",
        ],
        maxCachedIframes: MAX_CACHED_VSCODE_IFRAMES,
        mode: "preserve-state",
      }),
      ["session-f", "session-g", "session-h"],
    );
  });

  it("releases inactive iframe cache while keeping the active editor available", () => {
    assert.deepEqual(releaseVsCodeCacheSessionIds("active"), ["active"]);
    assert.deepEqual(releaseVsCodeCacheSessionIds(null), []);
  });
});
