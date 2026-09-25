import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FeishuCompletionFileReferenceService } from "./feishu-completion-file-reference-service.js";

test("turns trusted local Markdown file links into plain paths and bounded references", async () => {
  const parent = mkdtempSync(join(tmpdir(), "kanban-feishu-references-"));
  const root = join(parent, "session");
  const outside = join(parent, "sibling");
  const unrelated = mkdtempSync(join(tmpdir(), "kanban-feishu-unrelated-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(root, "src", "app.ts"), "export const app = true;\n");
    writeFileSync(join(root, ".env"), "TOKEN=secret\n");
    const outsidePath = join(outside, "outside.ts");
    const unrelatedPath = join(unrelated, "outside.ts");
    writeFileSync(outsidePath, "outside\n");
    writeFileSync(unrelatedPath, "nope\n");

    const content = [
      `查看 [app.ts](${join(root, "src", "app.ts")}:12)`,
      "以及 [相对路径](src/app.ts#L4)",
      "保留 [官网](https://example.com/docs)",
      `敏感 [配置](${join(root, ".env")})`,
      `外部 [文件](${outsidePath})`,
      `无关 [文件](${unrelatedPath})`,
      "```md",
      `[示例](${join(root, "src", "app.ts")}:99)`,
      "```",
    ].join("\n");

    const result = await new FeishuCompletionFileReferenceService({
      homeDirectory: join(parent, "not-the-home"),
    }).prepare({
      content,
      workingDirectory: root,
    });

    assert.deepEqual(result.references, [
      { path: "src/app.ts", line: 12 },
      { path: outsidePath },
    ]);
    assert.match(result.content, /查看 `src\/app\.ts:12`/);
    assert.match(result.content, /以及 `src\/app\.ts:4`/);
    assert.match(result.content, /\[官网\]\(https:\/\/example\.com\/docs\)/);
    assert.match(result.content, /敏感 `\.env`/);
    assert.ok(result.content.includes(`外部 \`${outsidePath}\``));
    assert.ok(result.content.includes(`无关 [文件](${unrelatedPath})`));
    assert.match(result.content, /```md\n\[示例\]\(/);
  } finally {
    rmSync(parent, { force: true, recursive: true });
    rmSync(unrelated, { force: true, recursive: true });
  }
});

test("trusts a regular file under the home directory outside the session", async () => {
  const home = mkdtempSync(join(tmpdir(), "kanban-feishu-home-"));
  const root = join(home, "workspace", "session");
  const paper = join(home, "notes", "paper.pdf");
  const hidden = join(home, ".secrets", "token.txt");
  const link = join(home, "notes", "link.txt");
  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(join(home, "notes"), { recursive: true });
    mkdirSync(join(home, ".secrets"), { recursive: true });
    writeFileSync(paper, "pdf");
    writeFileSync(hidden, "secret");
    writeFileSync(join(home, "notes", "target.txt"), "target");
    symlinkSync(join(home, "notes", "target.txt"), link);

    const result = await new FeishuCompletionFileReferenceService({
      homeDirectory: home,
    }).prepare({
      content: [
        `[旁边](../../notes/paper.pdf)`,
        `[密钥](${hidden})`,
        `[链接](${link})`,
        "[越界](/etc/passwd)",
      ].join("\n"),
      workingDirectory: root,
    });

    assert.deepEqual(result.references, [{ path: paper }]);
    assert.ok(result.content.includes(`\`${paper}\``));
    assert.ok(result.content.includes(`\`${hidden}\``));
    assert.ok(result.content.includes(`[链接](${link})`));
    assert.match(result.content, /\[越界\]\(\/etc\/passwd\)/);
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("keeps at most five unique preview references", async () => {
  const root = mkdtempSync(join(tmpdir(), "kanban-feishu-reference-cap-"));
  try {
    const links: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const name = `file-${index}.ts`;
      writeFileSync(join(root, name), String(index));
      links.push(`[${name}](${name})`);
    }
    links.push("[duplicate](file-0.ts)");

    const result = await new FeishuCompletionFileReferenceService().prepare({
      content: links.join("\n"),
      workingDirectory: root,
    });

    assert.equal(result.references.length, 5);
    assert.deepEqual(
      result.references.map((reference) => reference.path),
      ["file-0.ts", "file-1.ts", "file-2.ts", "file-3.ts", "file-4.ts"],
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("accepts an explicit local Markdown image as a safe file reference", async () => {
  const root = mkdtempSync(join(tmpdir(), "kanban-feishu-image-reference-"));
  try {
    writeFileSync(join(root, "preview.png"), "image-placeholder");

    const result = await new FeishuCompletionFileReferenceService().prepare({
      content: "结果：![预览图](preview.png)",
      workingDirectory: root,
    });

    assert.equal(result.content, "结果：`preview.png`");
    assert.deepEqual(result.references, [{ path: "preview.png" }]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
