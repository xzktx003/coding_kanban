import assert from "node:assert/strict";
import test from "node:test";

import type { FeishuNotificationSettingsResponse } from "@agent-orchestrator/shared";

import { buildServer } from "../app.js";
import { FeishuNotificationNotConfiguredError } from "../services/feishu-notification-settings-service.js";

test("Feishu notification settings API returns sanitized state and updates the switch", async () => {
  let state: FeishuNotificationSettingsResponse = {
    configured: true,
    destinationType: "user",
    enabled: true,
    replyConfigured: true,
    replyEnabled: false,
  };
  const { app } = buildServer({
    feishuNotificationSettingsService: {
      get: () => state,
      update: (input) => {
        state = { ...state, ...input };
        return state;
      },
    },
  });

  try {
    const initial = await app.inject({
      method: "GET",
      url: "/api/settings/feishu-notifications",
    });
    assert.equal(initial.statusCode, 200);
    assert.deepEqual(initial.json(), state);

    const updated = await app.inject({
      method: "PUT",
      url: "/api/settings/feishu-notifications",
      payload: { enabled: false },
    });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.json(), {
      configured: true,
      destinationType: "user",
      enabled: false,
      replyConfigured: true,
      replyEnabled: false,
    });

    const replyUpdated = await app.inject({
      method: "PUT",
      url: "/api/settings/feishu-notifications",
      payload: { replyEnabled: true },
    });
    assert.equal(replyUpdated.statusCode, 200);
    assert.equal(replyUpdated.json().replyEnabled, true);

    const invalid = await app.inject({
      method: "PUT",
      url: "/api/settings/feishu-notifications",
      payload: { enabled: "yes" },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("Feishu notification settings API rejects enabling without a local destination", async () => {
  const { app } = buildServer({
    feishuNotificationSettingsService: {
      get: () => ({
        configured: false,
        destinationType: null,
        enabled: false,
        replyConfigured: false,
        replyEnabled: false,
      }),
      update: () => {
        throw new FeishuNotificationNotConfiguredError();
      },
    },
  });

  try {
    const response = await app.inject({
      method: "PUT",
      url: "/api/settings/feishu-notifications",
      payload: { enabled: true },
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /\.env/);
  } finally {
    await app.close();
  }
});
