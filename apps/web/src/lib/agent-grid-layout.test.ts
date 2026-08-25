import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  AGENT_GRID_LAYOUT_STORAGE_KEY,
  loadAgentGridLayoutMode,
  saveAgentGridLayoutMode,
} from "./agent-grid-layout.js";

describe("agent grid layout preference", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("defaults to status sections and restores a saved group layout", () => {
    assert.equal(loadAgentGridLayoutMode(), "status");

    saveAgentGridLayoutMode("group");

    assert.equal(values.get(AGENT_GRID_LAYOUT_STORAGE_KEY), "group");
    assert.equal(loadAgentGridLayoutMode(), "group");
  });

  it("ignores invalid stored layout values", () => {
    values.set(AGENT_GRID_LAYOUT_STORAGE_KEY, "columns");

    assert.equal(loadAgentGridLayoutMode(), "status");
  });
});
