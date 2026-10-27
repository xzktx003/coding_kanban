# 主输入与展开编辑：输入、按钮和模式的独立对照

2026-10-27。范围沿用已批准 `plan.md`，保留公共输入、展开编辑、项目/分屏等特有能力。避开同期队列拖动、附件缩略图与模型 hCa 门控工作。

## 已闭环的真实缺陷

展开编辑“插入代码块”重复原正文且持久化，1440/390 两个真实红灯，已修复。光标、选区、代码块、中文组合输入和大文本边界见 [专项记录](expanded-code-insertion-20261027.md)。相关单测最终 13/13；桌面/手机返回、刷新真实回归 2/2；前端类型检查通过。

## 下一项明确差异：主发送按钮没有表达排队/引导语义

原包 `26.51007.21434` 的 `app-initial-fee819fe4f22.js` 中，`ewa` 是实际主 composer 控制和布局组件。它使用 `composer.submitButtonTooltip.send/queue/steer/stop`，按运行状态、提交模式和队列偏好决定主按钮 aria 标签；非 Aeon 分支运行中提交分别显示 `Queue`/`Steer`。原上层调用 `ewa` 的 `$o` 表达式为 `fo!=null || !Zo && Yt && (Ee || !lo) ? 'stop' : 'submit'`，其中 `lo` 包含正文/附件。

本轮没有重组几个相似按钮冒充原组件：通过受控 HTTP 响应仅追加 `ewa/dwa` 导出，文件本体和函数体不变；用原 controller、editor、路由、AppScope 和显式本地 fixture 挂载实际 `ewa`。每个 committed React tree 中 `ewa`、controller、editor 各 1，contenteditable 1；无原生 IPC、账号或真实任务。八格均得到原组件实际 DOM：

| 声明状态 | 1440 原组件 | 390 原组件 | 当前产品主输入 | 当前产品展开编辑 |
|---|---|---|---|---|
| 空闲、有正文 | `Send` | `Send` | `发送消息` | `发送消息` |
| 运行、空草稿、stop 模式 | `Stop` | `Stop` | `停止生成` | 未单独追加本格对照 |
| 运行、有正文、queue | `Queue` | `Queue` | `停止生成` + `发送消息` | `停止生成` + `加入队列` |
| 运行、有正文、steer | `Steer` | `Steer` | `停止生成` + `发送消息` | `停止生成` + `引导当前任务` |

当前 `Composer.tsx` 主按钮 `aria-label/title` 固定“发送消息”，展开编辑已经按同一 `preferences.mode` 区分行为。桌面和 390 实际 DOM 均证实；页面底部虽另有状态提示，按钮自身仍不表达当前动作。**建议下一项先复用展开编辑的动作名称给主按钮和 tooltip**，配合原生八格及产品两个尺寸的无提交 DOM 断言；不需要改变发送状态机。

## 第二项是确定的外观差异，需要保留功能后再决定对齐方式

原 `ewa` 每个上表普通状态只有一个 `primaryAction`；当前主输入及展开编辑在运行且有草稿时同时显示 Stop 与发送按钮。此差异已由真实 DOM 和原源码双证实，但**不等于应直接删除 Stop 能力**。项目保留显式停止、停止并发送、单次反向发送等入口是既有批准范围；如合并主动作，应先明确 Stop 的可见入口与键盘可达性，再验四种状态、停止中、审批/无 writer 和 390 宽度。这里未修改产品按钮，也未把未批准 `strict-parity-plan` 当作删功能授权。

## 已核对且没有新增故障结论的部分

- 主输入 placeholder 已按 goal → plan → 精确 thread identity 选择；后续空线程仍是 follow-up。当前 zh-CN 新建、后续、Goal 与原包字典对应；Plan 把原翻译“套餐”保留为任务语义“计划”，是已记录修正，不能当 parity bug 回退。
- 原布局确有 `auto-single-line` 与 `multiline`，但不同宿主、入口和状态选择不同。当前主输入固定 `multiline` 不能仅凭 grep 到别的分支就判错。已有原组件对照及手机 44px 触控/124px 高度属于批准适配；本轮没有证明应改自动单行。
- 当前“运行中发送方式”菜单可切 queue/steer，并保留单次反向动作与显式停止并发送；产品两个尺寸 DOM 观察未发现新增行为错误。完整原模式菜单没有在本轮挂载，不能宣称所有模式项已一致。
- 展开编辑为项目自有能力。其普通/代码编辑和返回持久化已验证，不将原包不存在同样全屏编辑 UI 当成删功能理由。

## 证据、执行与边界

产品 LAN URL：`https://10.30.0.24:8484`（HTTPS，8484）。本轮原组件复用其他审计 agent 的自有只读 HTTPS 代理 `https://10.30.0.24:37693`（只供 GET/HEAD 原资产），没有启动/停止正式服务，也没有改 root 所有的 HTTP 45439 reference。

固定原包主文件 SHA-256：`460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316`。完整当前相关源指纹保存于 `.dev-runtime/session-composer-input-audit-20261027/source-manifest.json`。

- `native-probe.mts` / `native-harness.js` / `native-prelude.js`：独立原组件诊断。`native-final/` 八份 JSON、八张截图及 `native-final.log`；8/8 具有期望标签、各组件计数为 1、无页面/fixture 错误、无拒绝写请求、无外部网络请求。仅追加导出；所有真实提交/停止回调禁止执行，配置与账号读取只返回自有合成 fixture。
- `product-observe.spec.ts` / `product.config.ts`：实际完整产品 DOM 观察，`product-observe-02/`，2/2 通过，13.4 秒；1440/390 各记录运行空草稿、queue/steer 主输入和展开编辑，无横向溢出，任务调用及页面错误为零。
- 旧 `product-observe/` 手机失败是诊断脚本在菜单退出动画期间立即复用按钮 locator；等待菜单真实隐藏后重新执行通过，未计作产品缺陷。
- HTTP reference 早期探针的 local-address-space/非安全上下文 crypto 失败保存为 `native-probe-0*.log`，属于诊断环境限制，不计产品或官方组件红灯。

这些原组件证据验证的是**声明 props 下完整 `ewa` 控件/原 editor/controller 的真实渲染**，未替代其上层完整 composer 所有状态计算、全部菜单、真实登录宿主或发送协议验收。对照使用英文原组件，未借英文/中文文本宽差宣称像素完全相同；本轮源码还有其他 agent 并行改动，也不宣称全仓冻结后的最终全目标验收。

## 后续闭环：主按钮动作名称

上述主按钮名称差异已修复：主输入与展开编辑复用同一个 `submitLabel`，按实际running及queue/steer设置显示“加入队列”“引导当前任务”，空闲仍为“发送消息”；主按钮title同步。显式Stop入口、发送/停止状态机与回执保护未改变。

`tests/e2e/session-composer-action-labels.spec.ts` 两个尺寸先红后绿（`labels-red.log`／`labels-green.log`），覆盖空闲、运行空草稿、queue、steer、展开/返回及完成回到空闲，原草稿保持，任务调用/pageerror均零。既有4个E2E文件7处running+queue按钮选择器改为精确“加入队列”并限定主composer owner，保留原行为/发送参数/几何断言；idle与SideChat/子Agent选择器不改，最终联合回归另记。原主控件布局和全部模式菜单的未闭合范围仍保留。

## 运行且有草稿时的单主动作与 Stop 入口（2026-10-27）

按批准范围保留显式停止，同时让主输入遵循原组件单一主动作：运行且有正文时，主按钮只显示 Queue/Steer；Stop 放入现有“附加文件”菜单，可用键盘焦点和 Enter 触发；菜单 Stop 正在处理时显示“正在停止”。运行但空草稿仍使用主 Stop。展开编辑是项目专有的全屏编辑器，仍保留直接 Stop。没有新增隐式中断、发送或任务恢复。

当前源码在 `apps/web/src/session-mode/components/codex/composer/Composer.tsx`。红灯来自 `tests/e2e/session-composer-action-labels.spec.ts`：运行且有正文时旧版仍渲染独立 Stop；实现后该用例通过，并在 1440/390 两种宽度覆盖 queue/steer、菜单键盘 Stop 与唯一 `turn/interrupt`。`session-composer-compact.spec.ts`、手机软键盘/展开编辑 `session-composer-v2.spec.ts`、Codex/CC/ACP 空草稿 Stop 与失败恢复 `session-stop.spec.ts`、队列菜单 `session-followups.spec.ts` 的相关用例通过；Stop 失败保留草稿，停止中不重复操作。

`session-codex-compact-controls.spec.ts` 的 360px 桌面/手机浅色/深色矩阵现为 4/4 通过，包含 Queue/Steer 主动作、菜单 Stop 和触控尺寸；完整主/展开 composer、更多状态与主题验收仍未关闭，附件两项精确像素差也仍待解释。`session-followups.spec.ts` 全部 12 项通过，覆盖 1440/900/375 宽度、队列编辑/重排/逐条移除、草稿保留、停止、权限和计划模式。
