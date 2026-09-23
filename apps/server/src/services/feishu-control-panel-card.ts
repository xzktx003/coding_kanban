import type { FeishuControlPanelCardInput } from "./feishu-control-panel-service.js";

interface ControlPanelCardInput {
  workspaceEnabled?: boolean;
  controlEnabled?: boolean;
  panelId: string;
  options: Array<{ value: string; label: string }>;
  quickRepliesEnabled?: boolean;
  quickReplies?: {
    options: Array<{ value: string; label: string }>;
    message?: string;
    boundTargetLabel?: string;
    editor?: { label: string; text: string };
  };
  truncated?: boolean;
  page?: number;
  pageCount?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  overview?: FeishuControlPanelCardInput["overview"];
}

const plain = (content: string) => ({ tag: "plain_text", content });
const QUICK_REPLY_EDITOR_PART_LIMIT = 1000;
const quickReplyCallback = (action: string, panelId: string) => [
  { type: "callback", value: { action, panelId } },
];

function splitByCodepoints(text: string, size: number) {
  const codepoints = Array.from(text);
  const parts: string[] = [];
  for (let index = 0; index < codepoints.length; index += size) {
    parts.push(codepoints.slice(index, index + size).join(""));
  }
  return parts.length ? parts : [""];
}

function buildNavigation(input: ControlPanelCardInput, refreshText: string) {
  const navigation: Array<Record<string, unknown>> = [];
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
    text: plain(refreshText),
    type: input.options.length ? "default" : "primary_filled",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { action: "kanban_refresh", panelId: input.panelId },
      },
    ],
  });
  return navigation;
}

function buildQuickReplyPanelCard(input: ControlPanelCardInput) {
  const quickReplies = input.quickReplies;
  const quickReplyOptions = quickReplies?.options ?? [];
  const hasCatalog = Boolean(quickReplyOptions.length);
  const hasBoundTarget = Boolean(quickReplies?.boundTargetLabel);
  const hasSelectableTarget = input.options.length > 0;
  const editor = quickReplies?.editor;
  const editorAvailable = Boolean(hasBoundTarget && editor);
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content:
        quickReplies?.message ??
        "选择快捷回复发送到目标会话；快捷回复内容来自本机本地配置。",
      text_size: "notation",
    },
  ];

  if (!hasCatalog) {
    elements.push({
      tag: "div",
      text: plain("暂无可用快捷回复，请检查本机快捷回复配置文件。"),
    });
  } else if (!hasBoundTarget && !hasSelectableTarget) {
    elements.push({
      tag: "div",
      text: plain("暂无可发送目标，请先创建或连接可回复的会话。"),
    });
  } else if (editorAvailable && editor) {
    const editorParts = splitByCodepoints(
      editor.text,
      QUICK_REPLY_EDITOR_PART_LIMIT,
    );
    const editorInputs = editorParts.map((part, index) => ({
      tag: "input",
      name: editorParts.length === 1 ? "prompt" : `prompt_${index}`,
      required: true,
      label: plain(
        editorParts.length === 1
          ? editor.label
          : `${editor.label}（第 ${index + 1}/${editorParts.length} 段）`,
      ),
      default_value: part,
      placeholder: plain(
        editorParts.length === 1
          ? "编辑后发送，最多 1000 字。"
          : "编辑后发送；服务端会按字段顺序拼接，总计最多 8000 字。",
      ),
      input_type: "multiline_text",
      rows: editorParts.length === 1 ? 8 : 4,
      max_length: QUICK_REPLY_EDITOR_PART_LIMIT,
      width: "fill",
    }));
    elements.push({
      tag: "form",
      name: "kanban_quick_reply_editor",
      vertical_spacing: "12px",
      elements: [
        {
          tag: "div",
          text: plain(`发送目标：${quickReplies?.boundTargetLabel}`),
        },
        ...editorInputs,
        ...(editorInputs.length > 1
          ? [
              {
                tag: "markdown",
                content:
                  "多段内容会按顺序拼接后发送，并保留换行；总计最多 8000 字。",
                text_size: "notation",
              },
            ]
          : []),
        {
          tag: "markdown",
          content: "发送前请补全方括号占位符，例如 [项目名]、[结论]。",
          text_size: "notation",
        },
        {
          tag: "button",
          name: `kanban_quick_confirm_${input.panelId}`,
          form_action_type: "submit",
          text: plain("发送快捷回复"),
          type: "primary_filled",
          width: "fill",
        },
      ],
    });
    elements.push({
      tag: "button",
      text: plain("换一条快捷回复"),
      type: "default",
      width: "fill",
      behaviors: quickReplyCallback("kanban_quick_back", input.panelId),
    });
  } else if (editor) {
    elements.push({
      tag: "div",
      text: plain(
        "编辑发送需要先锁定原会话，请从完成通知上的快捷回复按钮进入。",
      ),
    });
  } else if (!hasBoundTarget) {
    elements.push({
      tag: "select_static",
      name: "target",
      width: "fill",
      placeholder: plain("请选择目标会话"),
      options: input.options.map((option) => ({
        text: plain(option.label),
        value: option.value,
      })),
      behaviors: quickReplyCallback("kanban_quick_target", input.panelId),
    });
  } else {
    elements.push({
      tag: "div",
      text: plain(`发送目标：${quickReplies?.boundTargetLabel}`),
    });
    elements.push({
      tag: "select_static",
      name: "quickReply",
      width: "fill",
      placeholder: plain("请选择快捷回复"),
      options: quickReplyOptions.map((option) => ({
        text: plain(option.label),
        value: option.value,
      })),
      behaviors: quickReplyCallback("kanban_quick_preview", input.panelId),
    });
    elements.push({
      tag: "markdown",
      content:
        "选择模板后会在本卡片内进入可编辑预览，补全方括号占位符后再发送。",
      text_size: "notation",
    });
  }

  elements.push(...buildNavigation(input, "刷新快捷回复 / 打开新面板"));
  return {
    schema: "2.0",
    config: {
      width_mode: "default",
      enable_forward: false,
      update_multi: true,
    },
    header: {
      title: plain("Coding Kanban · 快捷回复"),
      subtitle: plain(
        hasBoundTarget
          ? "目标已确认，选择或编辑快捷回复"
          : "选择目标会话与快捷回复",
      ),
      template: "wathet",
    },
    body: { direction: "vertical", vertical_spacing: "12px", elements },
  };
}

export function buildFeishuControlPanelCard(input: ControlPanelCardInput) {
  if (input.quickReplies) {
    return buildQuickReplyPanelCard(input);
  }
  const overview = input.overview;
  const controlEnabled = input.controlEnabled ?? true;
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
  if (input.options.length && controlEnabled) {
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
          required: !input.workspaceEnabled,
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
        ...(input.workspaceEnabled
          ? [
              {
                tag: "button",
                name: `kanban_inspect_${input.panelId}`,
                form_action_type: "submit",
                text: plain("查看所选会话 / 记录 / 文件"),
                type: "default",
                width: "fill",
              },
            ]
          : []),
      ],
    });
  } else if (overview && !controlEnabled) {
    elements.push({
      tag: "markdown",
      content:
        "当前为只读任务总览：可以查看全部可见 session 的状态和最近摘要。若要发送指令、查看完整记录或浏览文件，请在 Kanban 中显式开启“飞书回复控制”。",
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
      content: controlEnabled
        ? "仅向本页所选 Codex 发送指令，直接回复原通知仍发送给原会话。面板有效期 15 分钟，每张仅提交一次；刷新会打开新面板。"
        : "这是只读任务总览。刷新会重新读取当前 session 注册表，面板有效期 15 分钟。",
    });
  }
  if (input.quickRepliesEnabled && controlEnabled) {
    navigation.push({
      tag: "button",
      text: plain("快捷回复"),
      type: "default",
      width: "fill",
      behaviors: [
        {
          type: "callback",
          value: { action: "kanban_quick_replies", panelId: input.panelId },
        },
      ],
    });
  }
  navigation.push(
    ...buildNavigation(
      input,
      overview ? "刷新任务总览" : "刷新对话列表 / 打开新面板",
    ),
  );
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
