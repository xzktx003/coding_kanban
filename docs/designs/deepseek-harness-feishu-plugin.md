# Harness 飞书插件（2026-11-09）

独立包 `packages/harness-feishu`，优先复用 Harness 已配置的机器人及现有 BotHarness 入站入口，不改 Harness 核心及 Kanban 通知服务。支持 Harness 普通会话（含分叉）本轮完成卡片，以及引用回复卡片继续同一会话。

## 事件与提交

只观察实时 `session/event` 的 `turn/start`、`assistant/message` 和 `turn/end`。仅转发成功完成轮次的最后一条助手文字，忽略推理、工具及子 Agent。安装前已经开始的轮次不补发。同步投影正文再排队发送，不把全量原生事件排入异步通知队列。

卡片回执绑定 Feishu message/chat ID 与 Harness session ID。回复须为指定用户、p2p、文字，且父消息或根消息对应同聊天的已绑定卡片；两者冲突则拒绝。CLI 正文优先按纯文字处理，兼容旧 JSON text。原生 `sessionController.prompt` 按精确 ID 恢复会话并排队，不使用标题猜测、不广播、不直接操作终端。提交带稳定 Feishu message ID 作为 requestId，复用原生校验及子 Agent 所有权保护。

状态目录0700、配置0600，状态只存小型身份和投递状态，保留7天且最多10000条。先保存 pending，再发送/提交；未知结果禁止自动重试。不能保证崩溃时恰好一次，可能保守漏发。最多256个活动轮次、128项队列；超限拒绝。卡片按UTF-8限制正文，显示截断说明。

## 安装与边界

已通过本机 HTTPS 3080 官方 `pluginManager/installBundle` 热安装本地包，回执 `application: applied`，`include:harness-feishu` 实际 `fiberPhase: active`。Harness 主进程 PID 保持不变，原 Kanban 插件仍 active。按用户确认改为复用 Harness 的 `infro_agent` 并启用通知。原所有者配置为通配符，实际接收人从已有私聊的唯一 Feishu 用户核对后仅写私有配置；新插件不扩大到通配符接收。

配置、操作与停用见[包说明](../../packages/harness-feishu/README.md)。启用需明确接收人、机器人身份与发送范围。独立验收会话经正常模型轮次完成，真实 Feishu API 发卡成功且状态为 sent，card 记录精确绑定该会话。用户尚未真实引用回复，故回程和后续模型轮次未验。当前支持引用回复卡片，尚无卡内表单、附件或审批，也没有接收确认/失败提示卡。仅声明本机已核对版本 0.2.1-rc.4。

## 验证

`pnpm --filter harness-feishu run check`；`pnpm --filter harness-feishu test`。覆盖成功轮次与历史/子 Agent 排除、分叉、纯文字、发送人/聊天绑定、冲突绑定、重复消息和未知提交、私有持久状态/独占、卡片字节预算、CLI机器人参数及关闭配置无副作用。真实卡片回执形状已验证；真实引用回复仍需用户动作。

## 复用已有机器人（用户确认后的实现）

本机 BotHarness 1.6.1 已通过 IM Provider 4.32.0-botharness.24 独占接收机器人消息；不能再启动 CLI 长连接争抢事件。原生 transport 从现有机器人配置读取 appId/secretRef，通过已存在 `ctx.credentials` 解析 secret，每次发送只在内存使用，不复制凭据。封装已安装 `createDshImProvider` 的 `consume`，注册到已有 `botharness.externalMessaging`：只处理本插件卡片绑定的父/root 回复，其余消息保持原接收回调。停用恢复原 provider。此注册会重建该 provider 入站租约，但不重启机器人长连接、Harness 或 Agent；该安装版本专用，未宣称跨版本兼容。

配置在本机私有文件，profile 私有 patch 引用 `configFile`；公开 bundle 继续默认关闭，无机器路径。启动依赖明确声明现有 IM/Core/Credentials，不能把 `{required,optional}` 当作 Cordis inject 对象（运行时会按服务名查找）。仅重载本插件后实际 active，主进程 PID 保持不变。真实发送凭据直接复用，原 Kanban 通知未改。
