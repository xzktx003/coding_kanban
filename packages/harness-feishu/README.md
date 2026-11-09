# Harness Feishu

独立 DeepSeek Harness bundle。优先复用 Harness 已配置的飞书机器人和原有消息入口；也保留独立 CLI 配置方式。监听原生 `session/event`，在已观察到的普通会话（包括分叉）轮次成功完成后，以现有飞书机器人私聊发送最终文字卡片。引用回复卡片，会经原生 `sessionController.prompt` 向卡片绑定的同一会话排队输入；原生接口负责恢复冷会话及验证所有权。

不修改 Harness 核心，不启动新 Harness，不重启正在运行的 Agent。子 Agent、历史轮次、失败/取消轮次、推理与工具输出不发卡。热安装时已经开始的轮次不补发。

## 检查与安装

```sh
pnpm --filter harness-feishu run check
pnpm --filter harness-feishu test
```

通过 Harness 官方 `pluginManager.installBundle(spec, options)` 安装本包或 npm pack 归档。Web RPC 路径为 `/api/pluginManager/installBundle`，参数 `{spec, options}` 放在标准 `payload.args` 中。检查 `pluginManager/listPlugins` 的 `include:harness-feishu` 是否 `fiberPhase: active`；如安装回执要求重启，留待维护窗口，不自动重启。

默认 `enabled: false`，此时不创建状态文件、事件消费者或发送消息。插件存在且 active 不代表通知已启用。

## 私有配置

部署包的 `cordis.patch.yml` 可仅引用本机私有配置文件：

```yaml
- insert:
    - id: harness-feishu
      name: harness-feishu
      config:
        configFile: /absolute/private/harness-feishu.json
```

配置文件须当前用户拥有、普通文件、权限 0600。不要把真实配置或接收人提交到仓库。

```json
{
  "enabled": false,
  "allowedUserId": "ou_REPLACE_WITH_CONFIRMED_RECIPIENT",
  "dataDir": "/absolute/private/notification-state",
  "cliHome": "/absolute/home/with/existing/lark-cli-login"
}
```

可选 `profile` 选择已有 lark-cli profile。Harness 的 HOME 可能是隔离服务目录，`cliHome` 显式让本插件的 CLI 子进程复用已有认证，不复制凭据、不改变宿主 HOME。`dataDir` 必须0700，只存会话/消息绑定及投递状态，不存对话正文。配置不会自动监听文件变更；修改后仅禁用/启用本插件以重新加载。

本机原生复用方式配置 `transport: "harness-native"`、`botId`、`botConfigFile`、`providerModule`（已安装 `@botharness/core` 的入口），以及从已有私聊核对的 `allowedUserId`。这些路径和身份均只写私有配置。机器人 app secret 每次操作经 `ctx.credentials.resolve` 读取，不复制到插件配置或 CLI。依赖已有 `dshIm` 和 `botharness` 服务；仅针对本机已安装的 BotHarness 1.6.1 / IM Provider 4.32.0-botharness.24 验证。

原生模式装饰现有 BotHarness provider 的 `consume` 入口，在它原有独占连接里过滤本插件已绑定卡片的回复；其余事件委托原接收函数。注册会重新建立此 provider 的入站租约，不重启 Harness、Agent 或机器人长连接。停用时恢复原 provider。

启用前明确接收人、机器人身份和发送范围（普通 Harness 会话每次成功完成的最终文字）。接收人同时是唯一允许回复的用户。仅接受 p2p、原卡片所在聊天、可验证的卡片父消息/根消息绑定和≤8000字符文字；普通无引用私聊、群聊、其他用户与附件忽略。对卡片使用飞书“回复”功能，输入文字发送；目前没有卡内输入框或审批按钮。

卡片和已处理消息保留7天，持久状态最多10000条，活动会话最多256，待处理通知/回复最多128。卡片正文按UTF-8限制并提示截断。发送/原生提交先记录意图；超时或结果未知不自动重试，以免重复发消息或执行任务。这是避免重复的保守策略，不保证断电情况下恰好一次。收到的回复通过原生接口排队，接受不等于执行完成；下一轮正常完成后再发新卡。错误仅写通用宿主日志，当前没有回复接收确认或失败提示卡。

飞书前置条件：已有 `lark-cli` 机器人配置、`im:message:send_as_bot` 和 `im:message.p2p_msg:readonly` 权限，以及控制台启用 `im.message.receive_v1` 长连接事件。不要在凭据错误时启动新登录或自动改权限。

## 停用与恢复

在 Harness Plugins 禁用此 bundle，插件仅关闭自己的 CLI 长连接和定时器，排队未提交工作丢弃，不停止 Harness/Agent。独占 `owner.lock` 防止两个实例并发消费；异常退出遗留锁时，先确认旧插件及消费者已退出，再由本机所有者移除该锁。不要在实例仍存活时删锁。

本机部署状态（2026-11-09）：已复用现有 `infro_agent` 机器人，原生模式开启，真实独立验收会话完成后成功发送卡片并持久绑定；仍需用户在飞书引用回复验证真实回程。

验证范围：本包单元测试覆盖绑定、去重、原生提交未知回执、普通/分叉/子 Agent 边界、CLI参数及私有状态。真实 Feishu API 发送及会话绑定已通过；卡片客户端显示、引用回复及实际模型继续仍需端到端验证。
