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

test("control panel exposes quick reply entry when enabled", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "abc",
    options: [{ value: "target1", label: "project · Codex" }],
    quickRepliesEnabled: true,
  });
  const json = JSON.stringify(card);
  assert.match(json, /快捷回复/);
  assert.match(json, /kanban_quick_replies/);
  assert.doesNotMatch(json, /kanban_quick_send_abc/);
});

test("quick reply panel first selects a target through a standalone callback", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "quick1",
    options: [
      { value: "codex-target", label: "repo · Codex" },
      { value: "claude-target", label: "repo · Claude" },
    ],
    quickReplies: {
      message: "选择快捷回复发送到目标会话。",
      options: [
        { value: "tpl-1", label: "继续" },
        { value: "tpl-2", label: "总结" },
      ],
    },
  });
  assert.equal(card.schema, "2.0");
  assert.equal(card.header.title.content, "Coding Kanban · 快捷回复");
  assert.equal(card.config.enable_forward, false);
  const form = card.body.elements.find(
    (element: any) => element.tag === "form",
  );
  assert.equal(form, undefined);
  const selects = card.body.elements.filter(
    (element: any) => element.tag === "select_static",
  ) as any[];
  assert.equal(selects.length, 1);
  const target = selects[0];
  assert.equal(target.name, "target");
  assert.equal(target.required, undefined);
  assert.equal(target.initial_option, undefined);
  assert.deepEqual(
    target.options.map((option: any) => option.value),
    ["codex-target", "claude-target"],
  );
  assert.deepEqual(target.behaviors, [
    {
      type: "callback",
      value: { action: "kanban_quick_target", panelId: "quick1" },
    },
  ]);
  const json = JSON.stringify(card);
  assert.doesNotMatch(json, /kanban_quick_send_quick1/);
  assert.doesNotMatch(json, /kanban_quick_edit_quick1/);
  assert.doesNotMatch(json, /请选择快捷回复/);
});

test("bound quick reply panel selects a template through a standalone preview callback", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "bound1",
    options: [{ value: "must-not-leak", label: "hidden option" }],
    quickReplies: {
      boundTargetLabel: "原会话 · Claude",
      options: [{ value: "tpl-1", label: "继续执行" }],
    },
  });
  const json = JSON.stringify(card);
  assert.match(json, /原会话 · Claude/);
  assert.doesNotMatch(json, /must-not-leak/);
  const form = card.body.elements.find(
    (element: any) => element.tag === "form",
  );
  assert.equal(form, undefined);
  const selects = card.body.elements.filter(
    (element: any) => element.tag === "select_static",
  ) as any[];
  assert.equal(selects.length, 1);
  const quickReply = selects[0];
  assert.equal(quickReply.name, "quickReply");
  assert.equal(quickReply.required, undefined);
  assert.deepEqual(
    quickReply.options.map((option: any) => option.value),
    ["tpl-1"],
  );
  assert.deepEqual(quickReply.behaviors, [
    {
      type: "callback",
      value: { action: "kanban_quick_preview", panelId: "bound1" },
    },
  ]);
  assert.doesNotMatch(json, /kanban_quick_send_bound1/);
  assert.doesNotMatch(json, /kanban_quick_edit_bound1/);
});

test("quick reply editor preserves multiline prompt as input value without markdown injection", () => {
  const prompt = "第一行\n**不要当 Markdown**\n<at id=all></at>";
  const card = buildFeishuControlPanelCard({
    panelId: "edit1",
    options: [{ value: "hidden", label: "hidden" }],
    quickReplies: {
      boundTargetLabel: "原会话",
      options: [{ value: "tpl-1", label: "模板一" }],
      editor: { label: "模板一", text: prompt },
    },
  });
  const form = card.body.elements.find(
    (element: any) => element.tag === "form",
  ) as any;
  const input = form.elements.find((element: any) => element.name === "prompt");
  assert.equal(input.default_value, prompt);
  assert.equal(input.input_type, "multiline_text");
  assert.equal(input.max_length, 1000);
  assert.equal(
    form.elements.some((element: any) => element.name === "prompt_0"),
    false,
  );
  assert.ok(
    form.elements.some(
      (element: any) => element.name === "kanban_quick_confirm_edit1",
    ),
  );
  const backButton = card.body.elements.find(
    (element: any) =>
      element.tag === "button" && element.text?.content === "换一条快捷回复",
  ) as any;
  assert.deepEqual(backButton.behaviors, [
    {
      type: "callback",
      value: { action: "kanban_quick_back", panelId: "edit1" },
    },
  ]);
  assert.equal(
    form.elements.some((element: any) => element.name === "quickReply"),
    false,
  );
  const injectedMarkdownNodes: any[] = [];
  function visit(value: any) {
    if (!value || typeof value !== "object") return;
    if (value.tag === "markdown" && value.content?.includes("<at id=all>")) {
      injectedMarkdownNodes.push(value);
    }
    Object.values(value).forEach(visit);
  }
  visit(card);
  assert.equal(injectedMarkdownNodes.length, 0);
  assert.match(JSON.stringify(card), /方括号占位符/);
});

test("quick reply editor splits long text by unicode codepoints without truncation", () => {
  const prompt = `${"a".repeat(999)}😀b`;
  const card = buildFeishuControlPanelCard({
    panelId: "long-edit",
    options: [{ value: "hidden", label: "hidden" }],
    quickReplies: {
      boundTargetLabel: "原会话",
      options: [{ value: "tpl-1", label: "长模板" }],
      editor: { label: "长模板", text: prompt },
    },
  });
  const form = card.body.elements.find(
    (element: any) => element.tag === "form",
  ) as any;
  const inputs = form.elements.filter(
    (element: any) => element.tag === "input",
  );
  assert.deepEqual(
    inputs.map((input: any) => input.name),
    ["prompt_0", "prompt_1"],
  );
  assert.deepEqual(
    inputs.map((input: any) => input.max_length),
    [1000, 1000],
  );
  assert.deepEqual(
    inputs.map((input: any) => input.default_value),
    [`${"a".repeat(999)}😀`, "b"],
  );
  assert.equal(
    inputs.map((input: any) => input.default_value).join(""),
    prompt,
  );
  assert.match(inputs[0].label.content, /第 1\/2 段/);
  assert.match(inputs[1].label.content, /第 2\/2 段/);
  assert.match(JSON.stringify(card), /按顺序拼接/);
  assert.match(JSON.stringify(card), /保留换行/);
});

test("quick reply panel without catalog or target renders a bounded empty state", () => {
  const noCatalog = buildFeishuControlPanelCard({
    panelId: "empty-quick",
    options: [{ value: "target", label: "target" }],
    quickReplies: { options: [] },
  });
  assert.equal(
    noCatalog.body.elements.some((element: any) => element.tag === "form"),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(noCatalog),
    /kanban_quick_send_empty-quick/,
  );
  assert.match(JSON.stringify(noCatalog), /暂无可用快捷回复/);

  const noTarget = buildFeishuControlPanelCard({
    panelId: "empty-target",
    options: [],
    quickReplies: { options: [{ value: "tpl-1", label: "继续" }] },
  });
  assert.equal(
    noTarget.body.elements.some((element: any) => element.tag === "form"),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(noTarget),
    /kanban_quick_send_empty-target/,
  );
  assert.match(JSON.stringify(noTarget), /暂无可发送目标/);
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

test("overview can stay read-only while reply control is disabled", () => {
  const card = buildFeishuControlPanelCard({
    panelId: "readonly-overview",
    options: [{ value: "opaque-target", label: "project" }],
    controlEnabled: false,
    overview,
  });
  const json = JSON.stringify(card);
  assert.doesNotMatch(json, /kanban_submit_readonly-overview/);
  assert.match(json, /当前为只读任务总览/);
  assert.match(json, /刷新任务总览/);
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
