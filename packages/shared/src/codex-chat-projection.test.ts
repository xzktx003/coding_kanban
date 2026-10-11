import assert from "node:assert/strict";
import test from "node:test";
import { projectCodexChatValue } from "./codex-chat-projection.ts";

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
