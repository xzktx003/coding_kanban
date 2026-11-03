# 会话模式当前差异与就绪清单（2026-11-03 复核）

> 用途：以 2026-10-29 逆向审计（基线 `f6699ba`，VSIX `openai.chatgpt 26.51007.21434`）为对照，
> 逐项核对当前 HEAD（`13067b34`，v1.3.0）后的真实状态。**结论：审计列出的绝大多数差异已在 v1.3.0 关闭。
> 本文件取代旧审计作为“当前缺口”的权威来源，避免重复开发已实现功能。**

复核方法：直接读当前源码 + 运行对应单测；未做真实宿主/长时间 E2E 的项标为“待宿主/E2E”。

## 一、审计 G01–G26 当前状态

| ID | 审计差异 | 当前状态 | 证据 / 备注 |
|---|---|---|---|
| G01 | `/ide` 入口死路，无 IDE 自动上下文切换 | **已处理**（命令移除） | 测试断言无 `ide`/`ide-context`；IDE 自动上下文本身仍 **宿主门控**，未实现 |
| G02 | `/init` 缺 AGENTS.md 存在检查 | **已修复** | `slashCommands.ts:149` paths-exist + truncated + scope guard |
| G03 | 会话动作菜单重命名 disabled | **已改变** | 无 `onRename` 时回退 `openOwnerForm("rename")` |
| G04 | 快捷键无按键捕获/保存，Reset 报错 | **已修复** | `sessionKeyboardShortcuts` 服务含 record/save/reset/bindings |
| G05 | 听写 starting disabled 却提示可取消 | **已核对** | `BrowserDictationButton.test` 证明 starting 态按钮非 disabled 且点击即取消；真实会话听写入口在 |
| G06 | 归档列表固定 50 条无游标 | **已修复** | `ArchivedThreadSettings` 有 nextCursor + 加载更多 |
| G07 | 流式正文纯文本，完成才 Markdown | **已修复** | `AgentMessageItem` 用 `StreamingCodexMarkdown` 渐进渲染 |
| G08 | commentary 展示全过程 | **已实现** | func_list “正文默认最新进展并可展开全部”；turn 工作折叠 |
| G09 | 缺主输入同条件 Resume | 待复核；空输入/继续语义已分列 | 需确认 interrupted 精确语义 |
| G10 | 听写未按 finish-for-send 联动 | **已修复** | `BrowserDictationButton.finishAndSend()` / retry / cancel |
| G11 | 归档未入全局 undo | **已修复** | `archiveThreadUndo` 用 `recordAppAction` 异步 undo/redo |
| G12 | undo/redo 同步 void 栈 | **已改进** | `appActionHistory` 支持 async transition；无 host/thread 分区仍为差异 |
| G13 | 归档撤销恢复原置顶 | 数据域差异（看板 pin vs 原生 pin） | 项目特色，不为 parity 合并 |
| G14 | 归档设置页英文 | **已改中文** | 刷新/游标重复提示为中文 |
| G15 | 未读写 attention store 非原生 read-state | 数据域差异 | 保留看板注意力语义 |
| G16 | Ultra fallback 缺 per-host non-full-access | **已补** | `ultraFullAccessGate` 有 permissionProfile + preferred-non-full-access-by-host-id |
| G17 | MCP App widget 未消费 resourceUri | **已修复** | `McpToolCallItem` 懒加载 `McpAppView` |
| G18 | MCP form Escape 折叠非取消 | **已修复** | `ElicitationItem` Escape 取消 + 防重复 |
| G19 | 无完整 Sources 聚合侧栏 | **已修复** | `features/sources/ThreadSources` + panel + catalogue + MCP preview（11 测试绿） |
| G20 | 新聊天 local/worktree 模式差异 | 宿主门控 | 项目用项目列表/关注标签替代；host flag 未证 |
| G21 | 文件/文件夹菜单 directory:false | **已改** | 标签改为“上传设备文件”；项目文件/目录独立入口 |
| G22 | rail 全组合/banner 优先级 | 部分；待像素对照 | `ComposerRail` 存在；组合一致性未完整 E2E |
| G23 | 图像额度失败无 image_gen 专卡 | **已修复** | `NativeGeneratedImages` 有 image_gen 额度卡 + 测试 |
| G24 | 未知协议 fallback 显示技术 JSON | **已核对** | `hiddenMethods` 覆盖 `thread/*` 方法；未知 item 走 raw-JSON fallback（`threadRows.metadata.test` 绿）；真正未知协议方法的端到端触发仍属边界 |
| G25 | bridge 把 outcome-unknown 当拒绝删 receipt | **已改进** | `sessionState.transitions.test` 区分 unknown 与 definite；默认 Session 不走该桥 |
| G26 | 刷新/composer 收尾 ≤2s 验收 | 待宿主/性能 | 需独立宿主验证 |

## 二、功能/消息/T 项当前状态（节选）

- T03 渐进 Markdown → 已实现（`StreamingCodexMarkdown`）。
- T05 commentary latest/all → 已实现（正文默认最新进展、可展开全部）。
- T17 image_gen 额度卡 → 已实现。
- T21 MCP App 交互 widget → 已实现（`McpAppView`）。
- T30 MCP form Escape 取消 → 已实现。
- T36 listAgents 中文误译 → 已修正（不再出现“房源/挂牌”）。
- T52 Sources 聚合侧栏 → **已实现**（本文件复核，11 单测绿）。
- T53 会话内查找 → 已实现（`findTranscriptMatchRange` / turnNavigation）。

## 三、仍属“宿主门控 / 需先验证能力”的候选（不做无条件开发）

- CMP-36/37/38/39：主 composer 的 local/worktree 切换、worktree toggle、本地 environment、branch dropdown（官方 `ide-context`/`composer.toggleWorktreeMode`/`U:Qd`）。→ **真实会话已核对**：composer 呈现项目/本地目录/工作环境选择器且可交互（`ComposerFooterLabel.controls/collapse`、`AgentWorkspaceSelect` 等 12 测试绿）；branch 仅在会话绑定 git worktree 时显示。
- G01（IDE 自动上下文）、G24（未知协议端到端复现）、G26（刷新 ≤2s 性能验收）。
- CMP-51：Realtime voice（双向语音）——官方有 feature/auth/host 门控，默认不列为本地缺口。

## 四、项目特色保留项（不是缺口，不做对齐）

跨设备关注标签、关闭标签不停止 Agent、归档显式生命周期与中文 toast、内存保护（接收前裁剪/有界流式/32MiB/16MiB/60s回收）、手机适配（Return 换行/固定高度/compact shelf）、展开编辑/上下文快照/绘图/冻结发送、模型目录未知不伪造、项目选择与关注标签联动（看板特有）。

## 五、结论

当前 v1.3.0 已把 10-29 审计绝大多数“未实现/UI 不对”项关闭。“剩余工作”主要是：

1. **E2E/验收**：对已对齐功能做严格浏览器验收（用户要求 playwright 端到端）。
2. **宿主门控项**：G01/G20/G24/G26 + CMP-36..39——需要真实宿主/fixture 验证，或用户明确是否要开发。
3. 极少量确实未闭合的交互细节（如 G05、G09、G22、G12 的 host/thread 分区）。

因此原目标“逐个开发这些功能”在三分之二以上是“验收已实现功能”，只有宿主门控子集存在真实的“新开发”空间。

## 六、本轮验收复核（2026-11-03）

- 单测/组件测试通过：T52 Sources（11）、T05 commentary latest/all（21）、G25 bridge 投递分类（17）、CMP-36..39 composer 选择器（12）、G24 未知协议（`threadRows.metadata`）。
- 真实会话验收：`https://10.30.0.26:8484`（当前账号、连接在线）确认 Sources 面板打开后保持打开并正确分组真实文件来源；composer 呈现项目/本地目录/工作环境/模型/权限选择器。
- 夹具局限：scope 守卫面板（Sources/历史来源/命令详情/MCP App）会在 `codex:disconnected` 时关闭；而 E2E 夹具把 codex 连接表示为离线，故以夹具驱动的 panel E2E 不稳定。真实会话验收可避免该假象。
- 仍宿主受阻：G01（IDE 自动上下文）、G26（刷新 ≤2s 性能）、CMP-51（实时语音）——需对应宿主能力。
