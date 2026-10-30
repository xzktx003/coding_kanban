import assert from "node:assert/strict";
import test from "node:test";
import { projectCodexChatValue } from "./codex-chat-projection.ts";

test("generated image quota failure keeps only exact native small metadata and drops all result bytes", () => {
  const item = { type: "imageGeneration", id: "quota", status: "failed", result: "x".repeat(4 * 1024 * 1024), failure: { type: "usageLimitExceeded", limitId: "image_gen", resetsAt: 1_900_000_000, private: "drop" } };
  const projected = projectCodexChatValue(item) as any;
  assert.deepEqual(projected.failure, { type: "usageLimitExceeded", limitId: "image_gen", resetsAt: 1_900_000_000 });
  assert.equal(projected.result, undefined);
  assert.ok(JSON.stringify(projected).length < 512);
  assert.equal(projectCodexChatValue(projected), projected);
  for (const failure of [{ type: "failed", limitId: "image_gen", resetsAt: null }, { type: "usageLimitExceeded", limitId: "tokens", resetsAt: null }, { type: "usageLimitExceeded", limitId: "image_gen", resetsAt: "tomorrow" }])
    assert.equal((projectCodexChatValue({ ...item, failure }) as any).failure, undefined);
});

test("MCP projection keeps bounded public arguments and drops the result body", () => {
  const projected = projectCodexChatValue({
    type: "mcpToolCall",
    server: "fixture-mcp",
    tool: "inspect",
    arguments: { path: "src/app.ts", note: "检查当前文件", nested: { secret: "drop" } },
    result: { content: [{ type: "text", text: "x".repeat(20_000) }] },
  }) as { arguments: Record<string, unknown>; result: unknown };
  assert.equal(projected.arguments.path, "src/app.ts");
  assert.equal(projected.arguments.note, "检查当前文件");
  assert.equal(projected.arguments.nested, undefined);
  assert.equal(projected.result, null);
  assert.equal(projectCodexChatValue(projected), projected);
});
test("MCP App projection retains only a bounded exact resource URI, never HTML or resource content", () => {
  const item = { type: "mcpToolCall", id: "widget", server: "local", tool: "show", appContext: { connectorId: "local", appName: "Example", resourceUri: "ui://example/view", private: "secret" }, result: { content: "private HTML" } };
  const projected = projectCodexChatValue(item) as any;
  assert.equal(projected.appContext.resourceUri, "ui://example/view");
  assert.equal(projected.appContext.private, undefined);
  assert.equal(projected.result, null);
  assert.equal(projectCodexChatValue(projected), projected);
  const legacy = projectCodexChatValue({ type: "mcpToolCall", mcpAppResourceUri: "ui://legacy/view" }) as any;
  assert.equal(legacy.mcpAppResourceUri, "ui://legacy/view");
  for (const uri of ["ui://" + "x".repeat(5000), "javascript:alert(1)", "ui://secret\nother"])
    assert.equal((projectCodexChatValue({ type: "mcpToolCall", mcpAppResourceUri: uri }) as any).mcpAppResourceUri, undefined);
});

test("auto-review projection keeps the public action label and drops oversized bodies", () => {
  const projected = projectCodexChatValue({
    method: "item/autoApprovalReview/completed",
    params: {
      threadId: "ux-0",
      reviewId: "review-denied",
      decisionSource: "agent",
      review: { status: "denied", rationale: "需要明确授权", secret: "drop-me" },
      action: {
        type: "command",
        source: "shell",
        command: "curl target",
        cwd: "/fixture",
        stdout: "x".repeat(20_000),
      },
    },
  }) as { params: { action: Record<string, unknown>; review: Record<string, unknown> } };
  assert.equal(projected.params.action.command, "curl target");
  assert.equal(projected.params.action.stdout, undefined);
  assert.equal(projected.params.review.secret, undefined);
  assert.equal(projected.params.review.rationale, "需要明确授权");
  const again = projectCodexChatValue(projected);
  assert.equal(again, projected);
});

test("MCP credential arguments never become public display metadata", () => {
  const projected=projectCodexChatValue({type:"mcpToolCall",server:"fixture",arguments:{path:"a.ts",secret:"private body",access_token:"private token",clientSecret:"private secret",password:"private password",note:"public note"}}) as any;
  assert.deepEqual(projected.arguments,{path:"a.ts",note:"public note"});
  assert.equal(JSON.stringify(projected).includes("private"),false);
});

test("MCP authentication challenges survive chat projection without result bodies or other metadata",()=>{
 const item={type:"mcpToolCall",server:"fixture",result:{_meta:{"mcp/www_authenticate":['Bearer scope="read profile"','Bearer scope="read write"'],secret:"drop"},content:[{text:"x".repeat(4*1024*1024)}]}};
 const projected=projectCodexChatValue(item) as any;
 assert.equal(projected.result,null);
 assert.deepEqual(projected.nativeMcpAuthChallenge,{scopes:["read","profile","write"]});
 assert.ok(JSON.stringify(projected).length<4096);
 assert.equal(projectCodexChatValue(projected),projected);
});
test("MCP challenge without scopes remains actionable, oversized scopes never become a partial OAuth grant",()=>{
 assert.deepEqual((projectCodexChatValue({type:"mcpToolCall",result:{_meta:{"mcp/www_authenticate":"Bearer"}}}) as any).nativeMcpAuthChallenge,{scopes:[]});
 assert.deepEqual((projectCodexChatValue({type:"mcpToolCall",result:{_meta:{"mcp/www_authenticate":'Bearer scope="'+"x".repeat(20000)+'"'}}}) as any).nativeMcpAuthChallenge,{scopes:[],truncated:true});
});

test("large file diff metadata survives a second projection without becoming an empty preview", () => {
  const projected = projectCodexChatValue({
    type: "fileChange",
    id: "large-patch",
    status: "completed",
    changes: [
      {
        path: "/project/large.py",
        kind: { type: "update", move_path: null },
        diff: `--- a/large.py\n+++ b/large.py\n${"+large-body-line\n".repeat(1800)}`,
      },
    ],
  }) as any;
  assert.equal(projected.changes[0].diff, "");
  assert.equal(projected.changes[0].transcriptMetadataOnly, true);
  const transported = JSON.parse(JSON.stringify(projected));
  const projectedAgain = projectCodexChatValue(transported) as any;
  assert.deepEqual(projectedAgain, transported);
  assert.equal(projectedAgain.changes[0].transcriptMetadataOnly, true);
  assert.equal(projectedAgain.changes[0].diff, "");
  const shortDiff = "@@ -1 +1 @@\n-old\n+new\n";
  const short = projectCodexChatValue({
    type: "fileChange",
    changes: [
      {
        path: "/project/short.py",
        kind: { type: "update", move_path: null },
        diff: shortDiff,
      },
    ],
  }) as any;
  assert.equal(short.changes[0].diff, shortDiff);
  assert.equal(short.changes[0].transcriptMetadataOnly, undefined);
  const unknownEmpty = projectCodexChatValue({
    type: "fileChange",
    changes: [
      {
        path: "/project/unknown.py",
        kind: { type: "update", move_path: null },
        diff: "",
      },
    ],
  }) as any;
  assert.equal(unknownEmpty.changes[0].diff, "");
  assert.equal(unknownEmpty.changes[0].transcriptMetadataOnly, undefined);
});

 test("auto-review does not expose an oversized command as a truncated executable action", () => {
  const projected = projectCodexChatValue({ method: "item/autoApprovalReview/completed", params: { threadId: "ux", action: { type: "command", command: "x".repeat(4 * 1024 * 1024), stdout: "secret" }, review: { status: "denied", rationale: "still public" } } }) as { params: { action: Record<string, unknown>; review: Record<string, unknown> } };
  assert.equal(projected.params.action.command, undefined);
  assert.equal(projected.params.action.stdout, undefined);
  assert.equal(projected.params.action.type, "command");
  assert.equal(projected.params.review.rationale, "still public");
 });
