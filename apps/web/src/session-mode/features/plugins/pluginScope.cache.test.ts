import { beforeEach, expect, test } from "vitest";
import { resetGoalCompletionScope } from "@session/services/goalCompletionAutoClear";
import { startCodexOperationScopeSync } from "@session/services/codexOperationScope";
import {
  publishPluginChange,
  readPluginCatalogCache,
  savePluginCatalogCache,
} from "./pluginScope";

beforeEach(() => publishPluginChange());

test.each(["same account notification", "runtime replacement"])(
  "an unmounted plugin catalog cannot reuse cached data after %s",
  (event) => {
    const stop = startCodexOperationScopeSync();
    try {
      const value = {
        marketplaces: [
          { name: "Original", path: "/private/market", plugins: [] },
        ],
        errors: [],
      };
      // No plugin UI/revision subscription is mounted. The ordinary application
      // scope observer continues independently of optional plugin rendering.
      savePluginCatalogCache(value);
      expect(readPluginCatalogCache()).toBe(value);
      if (event === "same account notification") resetGoalCompletionScope();
      else window.dispatchEvent(new Event("session-runtime-restarted"));
      expect(readPluginCatalogCache()).toBeNull();
      const fresh = { marketplaces: [], errors: [] };
      savePluginCatalogCache(fresh);
      expect(readPluginCatalogCache()).toBe(fresh);
    } finally {
      stop();
    }
  },
);
