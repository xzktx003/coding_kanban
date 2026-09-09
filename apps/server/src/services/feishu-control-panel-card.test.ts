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
