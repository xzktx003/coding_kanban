import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FeishuNotificationNotConfiguredError,
  FeishuNotificationSettingsService,
} from "./feishu-notification-settings-service.js";

function createFixture(env: NodeJS.ProcessEnv) {
  const directory = mkdtempSync(join(tmpdir(), "kanban-feishu-settings-"));
  const statePath = join(directory, "feishu-notification-settings.json");
  const service = new FeishuNotificationSettingsService({ env, statePath });

  return {
    service,
    statePath,
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

test("configured notifications stay enabled until the user explicitly disables them", () => {
  const fixture = createFixture({ FEISHU_NOTIFY_USER_ID: "ou_user123" });
  try {
    assert.deepEqual(fixture.service.get(), {
      configured: true,
      destinationType: "user",
      enabled: true,
    });

    fixture.service.activateKanbanDelivery();

    assert.deepEqual(fixture.service.update(false), {
      configured: true,
      destinationType: "user",
      enabled: false,
    });

    const persisted = JSON.parse(readFileSync(fixture.statePath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.equal(persisted.enabled, false);
    assert.equal(persisted.deliveryMode, "kanban");
    assert.equal("destination" in persisted, false);
    assert.equal("userId" in persisted, false);

    const reloaded = new FeishuNotificationSettingsService({
      env: { FEISHU_NOTIFY_USER_ID: "ou_user123" },
      statePath: fixture.statePath,
    });
    assert.equal(reloaded.get().enabled, false);
  } finally {
    fixture.cleanup();
  }
});

test("migrates a legacy hook switch to Kanban delivery without changing its value", () => {
  const fixture = createFixture({ FEISHU_NOTIFY_USER_ID: "ou_user123" });
  try {
    writeFileSync(
      fixture.statePath,
      JSON.stringify({ version: 1, enabled: false, updatedAt: "legacy" }),
      "utf8",
    );

    fixture.service.activateKanbanDelivery();

    assert.equal(fixture.service.get().enabled, false);
    const migrated = JSON.parse(readFileSync(fixture.statePath, "utf8"));
    assert.equal(migrated.version, 2);
    assert.equal(migrated.enabled, false);
    assert.equal(migrated.deliveryMode, "kanban");
    assert.equal(typeof migrated.updatedAt, "string");
  } finally {
    fixture.cleanup();
  }
});

test("unconfigured notifications are reported disabled without exposing config values", () => {
  const fixture = createFixture({});
  try {
    assert.deepEqual(fixture.service.get(), {
      configured: false,
      destinationType: null,
      enabled: false,
    });
    assert.throws(
      () => fixture.service.update(true),
      FeishuNotificationNotConfiguredError,
    );
  } finally {
    fixture.cleanup();
  }
});

test("conflicting or malformed destinations cannot be enabled", () => {
  for (const env of [
    { FEISHU_NOTIFY_USER_ID: "invalid" },
    {
      FEISHU_NOTIFY_CHAT_ID: "oc_group123",
      FEISHU_NOTIFY_USER_ID: "ou_user123",
    },
  ]) {
    const fixture = createFixture(env);
    try {
      assert.deepEqual(fixture.service.get(), {
        configured: false,
        destinationType: null,
        enabled: false,
      });
      assert.throws(
        () => fixture.service.update(true),
        FeishuNotificationNotConfiguredError,
      );
    } finally {
      fixture.cleanup();
    }
  }
});
