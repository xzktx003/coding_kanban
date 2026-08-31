# Codex 任务完成飞书通知

## 目标与边界

`scripts/codex-feishu-notify.mjs` 把 Codex 原生 `agent-turn-complete` 事件转换成一条飞书 bot 消息。它是机器本地的发送桥接器，不依赖 Coding Kanban 页面保持打开，也不会修改现有浏览器 Notification API 或会话 `idle` 判定。

数据流如下：

```text
Codex agent-turn-complete
  -> 用户级 notify 命令
  -> scripts/codex-feishu-notify.mjs
  -> lark-cli im +messages-send --as bot
  -> 飞书群聊或用户
```

桥接器只发送：

- 固定标题 `Coding Kanban · Codex 任务完成`
- `cwd` 的最后一级项目目录名，不发送完整机器路径
- 最后一条 Assistant 消息的有界摘要，默认最多 600 个字符

`input-messages` 不会被转发。摘要会移除 ANSI 和控制字符，但仍可能包含 Agent 最终回复中的业务信息；目标群或用户应按信息敏感级别选择。

Codex 仅允许从用户级配置读取 `notify`。为避免全局 hook 把其他项目的完成事件发到本项目目标，桥接器会先校验事件 `cwd`：只有本仓库根目录及其子目录中的 turn 才会继续发送，其它路径会静默忽略。

## 前置条件

1. 本机 PATH 中可执行 `node` 和 `lark-cli`。
2. `lark-cli` 已完成应用配置；首次使用时运行 `lark-cli config init --new`。
3. 飞书应用已启用机器人能力和 `im:message:send_as_bot` 权限。
4. 群聊通知时，机器人已经加入目标群；私聊通知时，机器人与目标用户已有可发送关系。
5. 仓库依赖已经安装，以便脚本读取根目录 `.env`。

凭证由 `lark-cli` 自己管理。不要把 App Secret、access token 或 webhook secret 写入仓库 `.env.example`、Codex 配置或脚本参数。

## 配置通知目标

复制 `.env.example` 为被 Git 忽略的 `.env`，然后只配置一个目标：

```dotenv
# 群聊，chat_id 以 oc_ 开头
FEISHU_NOTIFY_CHAT_ID=oc_xxx

# 或者私聊，用户 open_id 以 ou_ 开头
# FEISHU_NOTIFY_USER_ID=ou_xxx

FEISHU_NOTIFY_SUMMARY_MAX_CHARS=600
FEISHU_NOTIFY_TIMEOUT_MS=10000
FEISHU_NOTIFY_MAX_ATTEMPTS=2
```

`FEISHU_NOTIFY_CHAT_ID` 和 `FEISHU_NOTIFY_USER_ID` 必须且只能配置一个。脚本会校验 ID 形状，避免把目标值解释成额外命令参数。

配置边界：

- `FEISHU_NOTIFY_SUMMARY_MAX_CHARS`：80–2000，默认 600。
- `FEISHU_NOTIFY_TIMEOUT_MS`：1000–30000，默认 10000。
- `FEISHU_NOTIFY_MAX_ATTEMPTS`：1–3，默认 2。

## 启用 Codex notify

Codex 会忽略项目级 `.codex/config.toml` 中的 `notify`，因此需要在用户级 `~/.codex/config.toml` 添加以下配置，并把路径改为本仓库的绝对路径：

```toml
notify = ["node", "/absolute/path/to/coding_kanban/scripts/codex-feishu-notify.mjs"]
```

这个用户级 hook 会收到这台机器上的 Codex 完成事件，但桥接器只处理 `cwd` 位于本仓库内的事件，并始终读取它所在 coding_kanban 仓库根目录的 `.env`。如果 `config.toml` 已有 `notify`，不要直接覆盖，应由已有通知入口显式转发同一个 Codex JSON 参数到本脚本。

重新启动 Codex 后配置生效。每次事件的单个 JSON 参数由 Codex 自动追加，包含 `type`、`thread-id`、`turn-id`、`cwd` 和最后一条 Assistant 消息等字段。

## 验证

先验证命令形状而不发送消息：

```bash
lark-cli im +messages-send \
  --as bot \
  --chat-id oc_xxx \
  --text "Coding Kanban Codex notification dry run" \
  --idempotency-key codex-notify-dry-run \
  --dry-run
```

然后运行定向测试：

```bash
node --test scripts/codex-feishu-notify.test.mjs
```

选择好真实接收方后，可以通过完成一个普通 Codex turn 做端到端验证。飞书写操作必须使用已确认的接收方、消息内容和 bot 身份，不要用未知群聊或用户 ID 试发。

## 可靠性与错误处理

- 幂等键由 `thread-id + turn-id` 的 SHA-256 摘要生成，长度不超过飞书限制；同一事件重试时保持不变。
- 网络或进程类失败按 250ms 指数退避重试，认证、配置、权限、校验错误和高风险确认门禁不会盲目重试。
- 子进程使用固定的 `lark-cli` 可执行文件、参数数组和超时，不经过 shell。
- 只把 `lark-cli` JSON 信封中的 `ok: true` 视为成功，不使用旧式 `code === 0` 判断。
- 发送失败会写入 Codex 本地错误输出，但不会伪造成功；当前最小实现没有持久化 outbox，因此机器断电或进程被强制终止时不保证补发。
