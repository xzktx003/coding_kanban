import type { FeishuControlPanelCardInput } from "./feishu-control-panel-service.js";

interface ControlPanelCardInput {
  panelId: string;
  options: Array<{ value: string; label: string }>;
  truncated?: boolean;
  page?: number;
  pageCount?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  overview?: FeishuControlPanelCardInput["overview"];
}

const plain = (content: string) => ({ tag: "plain_text", content });

export function buildFeishuControlPanelCard(input: ControlPanelCardInput) {
  const overview = input.overview;
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content: overview
        ? `共 ${overview.total} 个可见会话 · 快照时间：${overview.updatedAt}\n状态来自看板，空闲不代表任务已完成；低置信度状态会标记待确认。最近输出摘要可能滞后，并非完整记录。`
        : "选择目标后发送指令。此面板不改变通知卡片的绑定，直接回复通知仍发送给原会话。面板 15 分钟内有效，每张仅提交一次。",
      text_size: "notation",
    },
  ];
  if (overview) {
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      horizontal_spacing: "8px",
      columns: [
        ["运行中", overview.running],
        ["等待输入", overview.awaitingInput],
        ["空闲", overview.idle],
        ["不可用", overview.unavailable],
      ].map(([label, count]) => ({
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "8px",
        vertical_spacing: "4px",
        elements: [
          { tag: "markdown", content: `## ${count}`, text_align: "center" },
          {
            tag: "div",
            text: {
              ...plain(String(label)),
              text_size: "notation",
              text_color: "grey",
              text_align: "center",
            },
          },
        ],
      })),
    });
    elements.push({
      tag: "column_set",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          vertical_spacing: "8px",
          elements: overview.entries.length
            ? overview.entries.map((entry) => ({
                tag: "div",
                text: plain(
                  `${entry.label}\n状态：${entry.status}\n最近输出摘要：${entry.summary || "暂无摘要"}`,
                ),
              }))
            : [
                {
                  tag: "div",
                  text: plain("暂无可见会话，请先在看板中创建或连接会话。"),
                },
              ],
        },
      ],
    });
  }
  if (input.options.length) {
    elements.push({
      tag: "form",
      name: "kanban_control",
      vertical_spacing: "12px",
      elements: [
        {
          tag: "select_static",
          name: "target",
          required: true,
          width: "fill",
          placeholder: plain("请选择 Codex 对话（项目 · 会话 · ID）"),
          options: input.options.map((option) => ({
            text: plain(option.label),
            value: option.value,
          })),
        },
        {
          tag: "input",
          name: "prompt",
          required: true,
          label: plain("发送指令"),
          placeholder: plain(
            "输入指令，最多 1000 字；长指令可继续回复原通知卡片。",
          ),
          input_type: "multiline_text",
          rows: 4,
          max_length: 1000,
          width: "fill",
        },
        {
          tag: "button",
          name: `kanban_submit_${input.panelId}`,
          form_action_type: "submit",
          text: plain("发送到所选 Codex 对话"),
          type: "primary_filled",
          width: "fill",
        },
      ],
    });
  } else {
    elements.push({
      tag: "markdown",
      content: overview
        ? "本页暂无可操作的 Codex 对话；非 Codex、离线或只读会话仅展示状态，可翻页查看其他会话。"
        : "**暂无可操作的 Codex 对话**\n请确认会话在线、可控制且能识别实际 Codex 对话。",
    });
  }
  const navigation: Array<Record<string, unknown>> = overview ? [] : elements;
  if (overview) {
    navigation.push({
      tag: "markdown",
      text_size: "notation",
      content:
        "仅向本页所选 Codex 发送指令，直接回复原通知仍发送给原会话。面板有效期 15 分钟，每张仅提交一次；刷新会打开新面板。",
    });
  }
  if (input.truncated) {
    navigation.push({
      tag: "markdown",
      content: `第 ${input.page ?? 1} / ${input.pageCount ?? 1} 页，请翻页查看其他对话。`,
      text_size: "notation",
    });
  }
  for (const [enabled, page, label] of [
    [input.hasPreviousPage, (input.page ?? 1) - 1, "上一页"],
    [input.hasNextPage, (input.page ?? 1) + 1, "下一页"],
  ] as const) {
    if (enabled)
      navigation.push({
        tag: "button",
        text: plain(label),
        type: "default",
        behaviors: [
          {
            type: "callback",
            value: { action: "kanban_page", panelId: input.panelId, page },
          },
        ],
      });
  }
  navigation.push({
    tag: "button",
    text: plain(overview ? "刷新任务总览" : "刷新对话列表 / 打开新面板"),
    type: input.options.length ? "default" : "primary_filled",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { action: "kanban_refresh", panelId: input.panelId },
      },
    ],
  });
  if (overview) {
    elements.push({
      tag: "column_set",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          vertical_spacing: "8px",
          elements: navigation,
        },
      ],
    });
  }
  return {
    schema: "2.0",
    config: {
      width_mode: "default",
      enable_forward: false,
      update_multi: true,
    },
    header: {
      title: plain(
        overview ? "Coding Kanban · 任务总览" : "Coding Kanban · Codex 对话",
      ),
      subtitle: plain(
        overview
          ? "会话状态与最近输出 · 选择会话继续执行"
          : "独立控制面板 · 选择目标后明确发送",
      ),
      template: "wathet",
    },
    body: { direction: "vertical", vertical_spacing: "12px", elements },
  };
}
