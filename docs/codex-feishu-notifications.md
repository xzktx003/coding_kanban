# Kanban 任务完成飞书通知

## 目标与边界

飞书通知由 Coding Kanban 后端统一触发。只要会话已经出现在看板中，按钮开启前已经运行的 Codex，以及之后启动的 Codex、Claude、Copilot、OpenCode 或 shell 会话，都会在新的完成边沿出现时发送提醒；不要求重启 Agent，也不要求浏览器页面保持打开。

```text
AgentSessionRegistry
  -> 已知会话 running → idle / exited / detached
  -> AgentCompletionFeishuNotifier
  -> scripts/codex-feishu-notify.mjs --kanban
  -> lark-cli im +messages-send --as bot
  -> 飞书群聊或用户
```

后端启动时把重启前持久化的会话状态作为基线：原本已经空闲或退出的 managed 会话在恢复期间即使短暂出现 `running`，也不会被误当成新任务并补发；重启前确实仍在运行的会话保持已武装，恢复后进入完成态时会正常发送。关闭按钮期间不发送，重新开启后只处理新的完成边沿。

完成判断复用看板现有状态模型，包括 PTY/tmux 输出和空闲检测。它能覆盖没有加载 Codex 原生 hook 的运行中进程，但不是 Codex 服务端的精确 turn 回执；未登记到看板的独立终端进程不在覆盖范围内。

发送内容包括：

- Agent 类型和看板会话名。
- 工作目录的最后一级项目名，不发送完整机器路径。
- 最后一条结构化 Agent 摘要或有界终端摘要，默认最多 600 个字符。

用户原始 prompt 不会被转发。摘要会移除 ANSI 和控制字符，但仍可能包含 Agent 输出中的业务信息；目标群或用户应按信息敏感级别选择。

## 前置条件

1. 本机 PATH 中可执行 `node` 和 `lark-cli`。
2. `lark-cli` 已完成应用配置；首次使用时运行 `lark-cli config init --new`。
3. 飞书应用已启用机器人能力和 `im:message:send_as_bot` 权限。
4. 群聊通知时，机器人已经加入目标群；私聊通知时，机器人与目标用户已有可发送关系。
5. Coding Kanban 后端保持运行并能观察目标会话。

凭证由 `lark-cli` 自己管理。不要把 App Secret、access token 或 webhook secret 写入仓库 `.env.example`、Codex 配置或脚本参数。

## 配置通知目标

复制 `.env.example` 为被 Git 忽略的 `.env`，然后只配置一个目标：

```dotenv
# 群聊，chat_id 以 oc_ 开头
FEISHU_NOTIFY_CHAT_ID=oc_xxx

# 或者私聊，用户 open_id 以 ou_ 开头
# FEISHU_NOTIFY_USER_ID=ou_xxx

FEISHU_NOTIFY_MESSAGE_CHUNK_CHARS=12000
FEISHU_NOTIFY_TIMEOUT_MS=10000
FEISHU_NOTIFY_MAX_ATTEMPTS=2
```

`FEISHU_NOTIFY_CHAT_ID` 和 `FEISHU_NOTIFY_USER_ID` 必须且只能配置一个。脚本会校验 ID 形状，避免把目标值解释成额外命令参数。

配置边界：

- `FEISHU_NOTIFY_MESSAGE_CHUNK_CHARS`：1000–30000，默认 12000；控制完整最后输出的单条消息分片大小，不截断正文。
- `FEISHU_NOTIFY_TIMEOUT_MS`：1000–30000，默认 10000。
- `FEISHU_NOTIFY_MAX_ATTEMPTS`：1–3，默认 2。

## 从看板开启或关闭

启动后端后，在电脑端看板打开：

```text
设置 → 飞书通知 → 飞书通知：开 / 关
```

前端通过 `GET /api/settings/feishu-notifications` 读取状态，并通过 `PUT /api/settings/feishu-notifications` 只提交布尔值 `enabled`。后端响应只包含：

- `enabled`：共享开关是否开启。
- `configured`：本地环境中是否恰好存在一个合法目标。
- `destinationType`：`user`、`chat` 或 `null`。

接口不会返回接收者 ID、App Secret、Token 或 `lark-cli` 登录态。接收者缺失、格式无效或同时配置群聊与用户时，界面会禁用开关；修改 `.env` 后需要重启 Coding Kanban 后端重新读取配置。

开关写入被 Git 忽略的 `.dev-runtime/feishu-notification-settings.json`，文件权限限制为当前用户，只包含版本、`kanban` 发送模式、布尔值和更新时间。后端启动会保留旧开关值并把旧版 hook 模式迁移成 Kanban 后端模式。

## 与 Codex 原生 notify 的关系

Codex 官方的 `notify` 配置会在支持的事件（当前为 `agent-turn-complete`）上调用外部程序，适合 webhook 或桌面通知，参见 [OpenAI Codex 高级配置文档](https://developers.openai.com/codex/config-advanced#notifications)。但它不能由看板按钮动态注入到已经运行且没有加载该配置的 Codex 进程。

新安装不需要再为 Kanban 飞书提醒配置用户级 Codex `notify`。旧安装可以暂时保留原配置：后端启动后会把本地状态标记为 `deliveryMode=kanban`；运行中的旧 Codex 即使继续调用 `scripts/codex-feishu-notify.mjs`，脚本也会在启动 `lark-cli` 前静默跳过，由后端发送唯一一条消息。

## 通知正文

Codex 会话输出变化后，后端会先从当前看板会话定位真实 Codex session，再防抖读取结构化 JSONL 尾部的原生 `task_complete` 事件。初次看到的旧事件只建立基线；新的 `turn_id` 各自触发一次通知，并直接使用该事件的完整 `last_agent_message`。因此 Codex 回复后即使在终端 15 秒空闲阈值内继续提问，两个 turn 也不会被合并或漏报；随后卡片进入 idle 时会按同一 `turn_id` 去重。即使卡片暂时标记为 `shell`，只要它是本机受管 tmux 且当前 pane 中运行的是 Codex，也会使用实际 Codex 对话正文。本机 session 文件路径和短期 pane 定位结果会缓存，远端读取使用有界尾部窗口；读取不到结构化完成记录、目标是其他明确 Agent，或远端缺少读取通道时，才回退到卡片摘要或终端预览。

发送使用 `lark-cli im +messages-send --text`，保留正文换行、缩进和 Markdown 字符的字面内容；ANSI 转义、不可见控制字符和完整工作目录会被清理。正文超过 `FEISHU_NOTIFY_MESSAGE_CHUNK_CHARS` 时按 Unicode 字符边界拆成多条“最后输出（序号/总数）”消息，每片使用独立且稳定的幂等键，因此不会为了满足单条消息大小而截断最后输出。

开启此功能意味着最后一条 Codex assistant 输出会被发送给 `.env` 中配置的飞书接收者。该正文可能包含代码、日志或任务上下文，配置私聊/群聊目标前应确认接收范围；用户提示、私钥内容、Token 和完整工作目录不会由通知器主动附加。

## 验证

先验证命令形状而不发送消息：

```bash
lark-cli im +messages-send \
  --as bot \
  --chat-id oc_xxx \
  --text "Coding Kanban notification dry run" \
  --idempotency-key kanban-notify-dry-run \
  --dry-run
```

然后运行定向测试：

```bash
pnpm --filter server exec tsx --test \
  src/services/agent-completion-feishu-notifier.test.ts \
  src/services/codex-completion-content-resolver.test.ts \
  src/services/feishu-notification-settings-service.test.ts
node --test scripts/codex-feishu-notify.test.mjs
```

端到端验收时，可以先开启开关，再让看板中一个已经运行的任务完成。飞书写操作必须使用已确认的接收方、消息内容和 bot 身份，不要向未知群聊或用户试发。

## 可靠性与错误处理

- 每次注册表快照先更新本地基线，再异步发送；重复空闲快照不会重复提醒，重启恢复的旧空闲会话不会形成通知风暴。
- 幂等键由看板会话 ID、完成边沿时间和正文分片序号生成；同一分片重试保持不变，已成功分片不会重复发送。
- 网络或进程类失败按 250ms 指数退避重试，认证、配置、权限、校验错误和高风险确认门禁不会盲目重试。
- 后端使用固定 Node 可执行文件和参数数组启动桥接脚本；桥接脚本以固定 `lark-cli` 参数数组发送，整个链路不经过 shell。
- 看板开关关闭时不会创建发送子进程；原生 hook 在 Kanban 接管模式下也会在启动 `lark-cli` 前短路。
- 只把 `lark-cli` JSON 信封中的 `ok: true` 视为成功。
- 发送失败写入 Kanban 后端日志，不会改变任务状态或伪造成功；当前没有持久化 outbox，机器断电或后端被强制终止时不保证补发。
