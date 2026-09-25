import assert from "node:assert/strict";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FeishuQuickReplyStore } from "./feishu-quick-reply-store.js";

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "kanban-feishu-quick-replies-"));
  const filePath = join(directory, "quick-replies.json");
  const store = new FeishuQuickReplyStore({ filePath });

  return {
    filePath,
    store,
    write: (value: unknown) =>
      writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

test("reads enabled quick replies and reloads edits on every read", () => {
  const fixture = createFixture();
  try {
    fixture.write({
      version: 1,
      replies: [
        {
          id: "continue",
          label: "继续",
          category: "常用",
          text: "继续完成上面的任务",
        },
      ],
    });

    const first = fixture.store.read();
    assert.deepEqual(first.items, [
      {
        id: "continue",
        label: "继续",
        category: "常用",
        text: "继续完成上面的任务",
      },
    ]);
    assert.equal(typeof first.revision, "string");
    assert.match(first.revision, /^sha256:[a-f0-9]{64}$/);
    assert.equal(first.message, undefined);

    fixture.write({
      version: 1,
      replies: [
        {
          id: "review",
          label: "检查",
          text: "请检查刚才的改动",
          requiresEditing: true,
        },
      ],
    });

    const second = fixture.store.read();
    assert.deepEqual(second.items, [
      {
        id: "review",
        label: "检查",
        text: "请检查刚才的改动",
        requiresEditing: true,
      },
    ]);
    assert.notEqual(second.revision, first.revision);
  } finally {
    fixture.cleanup();
  }
});

test("omits disabled entries before returning the catalog", () => {
  const fixture = createFixture();
  try {
    fixture.write({
      version: 1,
      replies: [
        { id: "enabled", label: "可用", text: "发送这条" },
        { id: "disabled", label: "禁用", text: "不显示", enabled: false },
      ],
    });

    assert.deepEqual(fixture.store.read().items, [
      { id: "enabled", label: "可用", text: "发送这条" },
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("returns a sanitized empty catalog for missing or malformed files", () => {
  const fixture = createFixture();
  try {
    const missing = fixture.store.read();
    assert.deepEqual(missing.items, []);
    assert.match(missing.message ?? "", /未找到|无法读取/);
    assert.doesNotMatch(missing.message ?? "", /quick-replies|kanban|ENOENT/);

    writeFileSync(
      fixture.filePath,
      '{"version":1,"replies":[{"id":"secret","label":"secret","text":"private prompt"',
      "utf8",
    );
    const malformed = fixture.store.read();
    assert.deepEqual(malformed.items, []);
    assert.match(malformed.message ?? "", /格式/);
    assert.doesNotMatch(
      malformed.message ?? "",
      /secret|private prompt|Unexpected|JSON/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("rejects duplicate ids and invalid structures without leaking content", () => {
  const fixture = createFixture();
  try {
    fixture.write({
      version: 1,
      replies: [
        { id: "same", label: "第一条", text: "private one" },
        { id: "same", label: "第二条", text: "private two" },
      ],
    });

    const duplicate = fixture.store.read();
    assert.deepEqual(duplicate.items, []);
    assert.match(duplicate.message ?? "", /重复/);
    assert.doesNotMatch(duplicate.message ?? "", /private|第一条|第二条/);

    fixture.write({
      version: 1,
      replies: [{ id: "bad space", label: "坏 ID", text: "hidden body" }],
    });

    const invalid = fixture.store.read();
    assert.deepEqual(invalid.items, []);
    assert.match(invalid.message ?? "", /无效|格式/);
    assert.doesNotMatch(invalid.message ?? "", /hidden body|bad space/);
  } finally {
    fixture.cleanup();
  }
});

test("enforces file, entry, label, category, and text size limits", () => {
  const fixture = createFixture();
  try {
    fixture.write({
      version: 1,
      replies: Array.from({ length: 81 }, (_, index) => ({
        id: `reply_${index}`,
        label: `回复 ${index}`,
        text: "ok",
      })),
    });
    const tooMany = fixture.store.read();
    assert.deepEqual(tooMany.items, []);
    assert.match(tooMany.message ?? "", /80/);

    fixture.write({
      version: 1,
      replies: [
        {
          id: "long_text",
          label: "超长文本",
          category: "a".repeat(41),
          text: "x".repeat(8_001),
        },
      ],
    });
    const tooLong = fixture.store.read();
    assert.deepEqual(tooLong.items, []);
    assert.match(tooLong.message ?? "", /长度|上限/);
    assert.doesNotMatch(tooLong.message ?? "", /xxxxxxxxxx/);

    truncateSync(fixture.filePath, 512 * 1024 + 1);
    const oversize = fixture.store.read();
    assert.deepEqual(oversize.items, []);
    assert.match(oversize.message ?? "", /512 KiB/);
  } finally {
    fixture.cleanup();
  }
});

test("rejects unsafe control characters while preserving multiline text", () => {
  const fixture = createFixture();
  try {
    fixture.write({
      version: 1,
      replies: [
        {
          id: "multiline",
          label: "多行",
          text: "第一行\n第二行\t缩进",
        },
      ],
    });
    assert.equal(fixture.store.read().items[0]?.text, "第一行\n第二行\t缩进");

    fixture.write({
      version: 1,
      replies: [
        {
          id: "escape",
          label: "控制",
          text: "secret\u001b[31m",
        },
      ],
    });
    const unsafe = fixture.store.read();
    assert.deepEqual(unsafe.items, []);
    assert.match(unsafe.message ?? "", /控制字符/);
    assert.doesNotMatch(unsafe.message ?? "", /secret/);
  } finally {
    fixture.cleanup();
  }
});
