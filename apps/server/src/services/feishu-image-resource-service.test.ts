import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractFeishuImageKey,
  FeishuImageResourceService,
  FeishuImageResourceUnavailableError,
} from "./feishu-image-resource-service.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

test("extractFeishuImageKey accepts only one rendered Feishu image marker", () => {
  assert.equal(
    extractFeishuImageKey("![Image](img_v3_safe_image_key)"),
    "img_v3_safe_image_key",
  );
  assert.equal(extractFeishuImageKey("img_v3_safe_image_key"), null);
  assert.equal(
    extractFeishuImageKey("![Image](img_v3_safe_image_key) trailing"),
    null,
  );
});

test("downloads one Feishu image as the bot and removes the temporary file", async () => {
  const root = mkdtempSync(join(tmpdir(), "feishu-image-resource-test-"));
  let receivedArgs: string[] = [];
  try {
    const service = new FeishuImageResourceService({
      tempRoot: root,
      async runCommand(args) {
        receivedArgs = args;
        const outputIndex = args.indexOf("--output");
        await writeFile(args[outputIndex + 1]!, png);
      },
    });

    const resource = await service.download({
      messageId: "om_image_reply",
      imageKey: "img_v3_safe_image_key",
    });

    assert.deepEqual(resource, { image: png, imageExtension: "png" });
    assert.deepEqual(receivedArgs, [
      "im",
      "+messages-resources-download",
      "--message-id",
      "om_image_reply",
      "--file-key",
      "img_v3_safe_image_key",
      "--type",
      "image",
      "--output",
      receivedArgs[9],
      "--as",
      "bot",
      "--format",
      "json",
    ]);
    assert.equal(receivedArgs[9]?.startsWith(root), true);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects oversized or disguised Feishu image resources and still cleans up", async () => {
  const root = mkdtempSync(join(tmpdir(), "feishu-image-validation-test-"));
  try {
    for (const image of [Buffer.alloc(17, 1), Buffer.from("not-an-image")]) {
      const service = new FeishuImageResourceService({
        maxBytes: 16,
        tempRoot: root,
        async runCommand(args) {
          const outputIndex = args.indexOf("--output");
          await writeFile(args[outputIndex + 1]!, image);
        },
      });

      await assert.rejects(
        service.download({
          messageId: "om_image_reply",
          imageKey: "img_v3_safe_image_key",
        }),
        FeishuImageResourceUnavailableError,
      );
      assert.deepEqual(readdirSync(root), []);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
