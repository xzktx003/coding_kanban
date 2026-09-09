interface ControlPanelCardInput {
  panelId: string;
  options: Array<{ value: string; label: string }>;
  truncated?: boolean;
  page?: number;
  pageCount?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

const plain = (content: string) => ({ tag: "plain_text", content });

export function buildFeishuControlPanelCard(input: ControlPanelCardInput) {
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content:
        "选择目标后发送指令。此面板不改变通知卡片的绑定，直接回复通知仍发送给原会话。面板 15 分钟内有效，每张仅提交一次。",
      text_size: "notation",
    },
  ];
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
      content:
        "**暂无可操作的 Codex 对话**\n请确认会话在线、可控制且能识别实际 Codex 对话。",
    });
  }
  if (input.truncated) {
    elements.push({
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
      elements.push({
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
  elements.push({
    tag: "button",
    text: plain("刷新对话列表 / 打开新面板"),
    type: input.options.length ? "default" : "primary_filled",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { action: "kanban_refresh", panelId: input.panelId },
      },
    ],
  });
  return {
    schema: "2.0",
    config: {
      width_mode: "default",
      enable_forward: false,
      update_multi: true,
    },
    header: {
      title: plain("Coding Kanban · Codex 对话"),
      subtitle: plain("独立控制面板 · 选择目标后明确发送"),
      template: "wathet",
    },
    body: { direction: "vertical", vertical_spacing: "12px", elements },
  };
}
