import assert from "node:assert/strict";
import test from "node:test";
import { buildFeishuControlPanelCard } from "./feishu-control-panel-card.js";

test("control panel submits target and prompt together without changing notification replies", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "abc",
    options: [{ value: "target1", label: "project · Codex" }],
  });
  assert.equal(card.schema, "2.0");
  const form = card.body.elements.find(
    (element) => element.tag === "form",
  ) as any;
  const select = form.elements.find(
    (element: any) => element.tag === "select_static",
  );
  const input = form.elements.find((element: any) => element.tag === "input");
  const submit = form.elements.find((element: any) => element.tag === "button");
  assert.equal(select.name, "target");
  assert.equal(select.required, true);
  assert.equal(select.initial_option, undefined);
  assert.equal(input.name, "prompt");
  assert.equal(input.max_length, 1000);
  assert.equal(submit.name, "kanban_submit_abc");
  assert.equal(submit.form_action_type, "submit");
  assert.equal(submit.behaviors, undefined);
  assert.match(JSON.stringify(card), /原会话/);
});

test("empty control panel offers refresh without an invalid empty selector", () => {
  const card = buildFeishuControlPanelCard({ panelId: "abc", options: [] });
  assert.equal(
    card.body.elements.some((element) => element.tag === "form"),
    false,
  );
  assert.match(JSON.stringify(card), /kanban_refresh/);
});

test("large session lists expose pagination actions scoped to the current panel", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "abc",
    options: [],
    truncated: true,
    page: 2,
    pageCount: 3,
    hasPreviousPage: true,
    hasNextPage: true,
  });
  const actions = card.body.elements.filter(
    (element) => element.tag === "button",
  );
  assert.match(JSON.stringify(actions), /kanban_page/);
  assert.match(JSON.stringify(card), /第 2 \/ 3 页/);
});

const overview = {
  updatedAt: "2026-09-09T08:00:00.000Z",
  total: 4,
  running: 1,
  awaitingInput: 1,
  idle: 1,
  unavailable: 1,
  entries: [
    {
      label: "project <at id=all></at>",
      status: "运行中",
      summary: "正在检查 **测试**",
    },
    { label: "offline", status: "离线", summary: "" },
  ],
};

test("workspace entry shares the target selector but does not require a Codex instruction", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "inspect1",
    options: [{ value: "t1", label: "project" }],
    workspaceEnabled: true,
  });
  const form = card.body.elements.find(
    (element: any) => element.tag === "form",
  ) as any;
  assert.ok(form);
  assert.equal(
    form.elements.find((element: any) => element.name === "prompt").required,
    false,
  );
  assert.ok(
    form.elements.some(
      (element: any) => element.name === "kanban_inspect_inspect1",
    ),
  );
});

test("overview groups status counts and safely displays recent output with the original submit form", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "overview1",
    options: [{ value: "opaque-target", label: "project" }],
    overview,
  });
  assert.equal(card.header.title.content, "Coding Kanban · 任务总览");
  const json = JSON.stringify(card);
  assert.match(json, /运行中/);
  assert.match(json, /等待输入/);
  assert.match(json, /空闲/);
  assert.match(json, /不可用/);
  assert.match(json, /2026-09-09/);
  assert.match(json, /刷新任务总览/);
  assert.match(json, /kanban_submit_overview1/);
  assert.match(json, /最近输出摘要/);
  assert.ok(card.body.elements.some((element) => element.tag === "column_set"));
  // Runtime labels/output are plain text, never executable mentions or markup.
  const textNodes: any[] = [];
  function visit(value: any) {
    if (!value || typeof value !== "object") return;
    if (value.content?.includes("<at id=all>")) textNodes.push(value);
    Object.values(value).forEach(visit);
  }
  visit(card);
  assert.equal(textNodes.length, 1);
  assert.equal(textNodes[0].tag, "plain_text");
});

test("empty overview distinguishes no sessions from a page with no controllable Codex", () => {
  const empty = buildFeishuControlPanelCard({
    panelId: "empty",
    options: [],
    overview: { ...overview, total: 0, entries: [] },
  });
  assert.match(JSON.stringify(empty), /暂无可见会话/);
  assert.equal(
    empty.body.elements.some((element) => element.tag === "form"),
    false,
  );
  const unavailable = buildFeishuControlPanelCard({
    panelId: "offline",
    options: [],
    overview,
  });
  assert.match(JSON.stringify(unavailable), /本页暂无可操作的 Codex 对话/);
  assert.doesNotMatch(JSON.stringify(unavailable), /暂无可见会话/);
});

test("full overview page stays bounded and scopes navigation without trusting a client mode", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "panel-opaque-id",
    options: Array.from({ length: 10 }, (_, i) => ({
      value: `target-${i}`,
      label: "😀".repeat(120),
    })),
    overview: {
      ...overview,
      entries: Array.from({ length: 10 }, () => ({
        label: "😀".repeat(120),
        status: "等待输入（状态待确认）",
        summary: "😀".repeat(300),
      })),
    },
    truncated: true,
    page: 2,
    pageCount: 3,
    hasPreviousPage: true,
    hasNextPage: true,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(card)) < 30 * 1024);
  assert.ok(card.body.elements.length <= 5);
  const callbacks: any[] = [];
  function visit(value: any) {
    if (!value || typeof value !== "object") return;
    if (value.type === "callback") callbacks.push(value.value);
    Object.values(value).forEach(visit);
  }
  visit(card);
  assert.deepEqual(callbacks, [
    { action: "kanban_page", panelId: "panel-opaque-id", page: 1 },
    { action: "kanban_page", panelId: "panel-opaque-id", page: 3 },
    { action: "kanban_refresh", panelId: "panel-opaque-id" },
  ]);
});
