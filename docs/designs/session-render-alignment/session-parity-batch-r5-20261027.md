# 第五批：权限来源、模型菜单与通知身份

完整目标继续按 [当前审计](current-goal-audit-20261027.md) 执行；本批不关闭原生 SDK gate/ACK、附件像素、长期 RSS 或完整原生状态矩阵。

## 改动与证据

- [通知唯一身份](notice-identity-dismiss-20261027.md)：提交合并改变数字 revision 后，延迟关闭仍认领同一 UUID；旧数字接口和新通知防护保留。专项 69 单测、11 项实际浏览器通过。此项为 API 边界，未把尚无 UI 触发证据的延迟回调描述成已发生的用户故障。
- [模型菜单](model-menu-reset-touch-20261027.md)：补齐 explicit model 的 Reset，保留速度/草稿，触控 view change 不额外聚焦；Reset tooltip 可见时一次 Escape 同时关闭菜单并回原 composer。实际原组件/本地 1440 与 375 两尺寸及 Reset/tooltip 专项 3 项通过，原包 11 个资产 SHA 固定；完整模型选择器单测 21 文件 279 项通过，最终额外 Escape 修改随后由联合测试覆盖。
- [权限来源](thread-permission-provenance-20261027.md)：实际前端参数经 Fastify queue 与 Ownership 到原生 raw 捕获证明，未知、仅 model 和不透明旧缓存原先会带出 `never`/`dangerFullAccess`。新增按字段来源，显式同值选择进入事务与捕获边界，原生缺字段不制造完整 policy；发送遇到不可表达的网络修改保持未开始并保留草稿。审批人未确认也不显示为 user 模式；已有 Goal-only 和 completed rollback 的冻结参数保持独立。真实账号、正式 writer 和任务不作为合成捕获对象。
- [父菜单生命周期](composer-parent-menu-lifecycle-20261027.md)：会话动作关闭父附加层，手机可直接点击新导航；本体稳定挂载，独立确认表单保留，Escape 逐层返回。没有新增 owner key 或隐式表单 reset。
- [冷启动会话链接](thread-link-account-ready-20261027.md)：在原 15 秒截止内等首次账号确认再发唯一链接读取；等待时换会话只缓存原历史，后续账号撤销仍拒绝，超时/新请求替换立即退订。
- [附件绘制诊断](queue-image-paint-20261027.md)：修正原生 data URL 与本地网络 URL 的测试条件差异，永久用同一实际 fileSrc URL 并验证响应内容；共享预览/排序 14 项通过。附件专项仍为 2 通过、2 像素矩阵失败，冷加载与同 context 反例分开保存，没有产品 CSS 修改或容差放宽。

## 合并验证

本批统一验收目录为 `.dev-runtime/session-parity-batch-r5-20261027/`。最终源码验证如下：

| 门禁 | 结果与证据 |
| --- | --- |
| 完整 Session/Codex UI 单测配置 | `session-all-r3.log`：586 文件、3615 项全部通过，449.16 秒；不是整个 monorepo 的 `pnpm test` |
| 多页设置、保存/发送、HMR/HTTP、捕获与权限/Goal | `browser-accepted.log`：23 项全部通过，47.1 秒 |
| 完整工作流 | `.dev-runtime/session-thread-workflows-entry-20261027/final-18-r3/`：18 项全部通过，2.0 分钟，2282 个输入前后不变 |
| 官方原组件/本地模型菜单 | `menus-accepted.log`：3 项通过，1.0 分钟，含两尺寸键盘/触控与 Reset/tooltip；原 11 资产 SHA 固定 |
| 前后端检查与生产构建 | `check-accepted.log`：`pnpm check` 退出 0；本次 Vite 构建 45.92 秒。原有大 chunk 提示保留，未改阈值 |
| 源码一致性 | `source-verification.json`：3380 个输入最终前后哈希相同；覆盖全部产品、相关 fixture/测试与构建配置，不读取 env 内容 |
| 正式只读复验 | `real-accepted.log` / `real/browser-result.json`：1600×1000、393×852 均有回复/待回答问题，9 历史响应全 200，加载提示/页面异常/任务写入/横向溢出均为零 |

完整单测开始后只细化了独立浏览器 spec 的坐标/读取来源观察；产品与 Vitest 输入未变，`vitest-input-verification.json` 明确记录该唯一差异，没有把修改前的浏览器结果当作最终通过。几何改为浮点 DOMRect 与浮点文档边界、整数 clientHeight 与整数 scrollHeight 分别比较，仍无容差；读取通过实际 CDP initiator 区分 URL 与原有 metadata 通道，并按精确 threadId 计数。

上述浏览器为 **44 个互不重复的最终用例**（23+18+3）；此前父层 6 项、附件 preview/sort 14 项等专项另列，不重复拼入这个计数。正式复验保留导航取消请求日志；plan-window 夹具的 Vite WS 连接错误日志也保留，不把页面异常为零解释成所有资源/网络都成功。前端实际 LAN 入口保持可达，原 Session 运行层 PID 2712539 未替换；`session:status` 明确磁盘新运行层尚未启用，Codex 只读状态为 broker-ready，不代表模型对话已经验证。

## 失败记录与回归修正

首次完整配置为 3600 通过、5 失败（`session-all-final.log`），保留原日志：三项 fork 权限来源标记回归修为按分支实际应用的字段更新；一项旧断言依赖同值选择丢 pending 的已修 bug，改为保留明确意图，null policy/最终发送断言保持；另一个上传取消夹具的 50ms 自动完成与点击竞争，改为等真实 AbortSignal 取消并加强取消断言，产品上传逻辑未变。

旧工作流入口、代码复制按钮名称、混合浮点/整数坐标与跨 thread 的 CDP 计数均有原失败记录；修正定位和观察定义，没有添加强制点击、额外 Escape、像素容差或删除草稿/身份/参数断言。真实手机父层遮挡与冷启动链接竞态分别修复产品。附加层稳定挂载的表单跨 owner 未保存保护仍是独立待审边界。

正式入口仍为 HTTPS `https://10.30.0.24:8484`（端口 8484）；本批浏览器修改场景使用隔离接口夹具。截图消息加载的真实只读复验另见 `.dev-runtime/history-screenshot-recheck-20261027-080557/`：两尺寸正常、9 历史 200、任务写入与页面异常均为零，原 Session 运行层 PID 2712539 保留。未提交或推送代码，保留其他工作区改动。


## 下一项已确认问题

最后只读生命周期复核没有发现新增persistent菜单导致多份快捷键sheet；同时发现Settings二级页的原有custom-event监听在Session隐藏时仍会设置打开状态，返回后才弹出。证据位于 `.dev-runtime/session-conversation-shortcuts-audit-20261027/`。本批未修改该既有分支，下一批应按真实隐藏/返回流程修复；全量通过不代替此未覆盖行为的完成证明。
