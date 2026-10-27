# 第三批：队列交互、展开编辑与模型提示入口

继续执行已批准的 [完整方案](plan.md)。本批交付不等于整个目标完成；尤其附件精确像素、正式模型提示门控及新发现的线程设置跨页覆盖仍有明确缺口。

## 本批变更

| 范围 | 结果及证据 |
| --- | --- |
| 排序手柄和状态门控 | 与实际原组件一致的六点 hover 手柄、PointerSensor 6px、精确目标顺序；单条/混合状态禁用，取消只影响自有队列。原版未启用 KeyboardSensor，项目菜单移动保留。两主题手柄完整 PNG 相同；[排序证据](queue-sorting-20261027.md) |
| 手势退出与移动端 | 释放固定版本自有 sensor，修复卸载后吞点击及真实 pointerup 微任务过早清理。19项生命周期覆盖；手机详情44px热区、真实触控及20条队列滚动排序通过 |
| 图片与摘要 | 首图24px，折叠只请求首图，展开保留全部原图/原文；粘贴80 UTF-16预览、选区和图像摘要，项目完整文件名仍保留。18单测及功能回归通过；[视觉红灯与边界](queue-preview-parity-20261027.md)继续保留 |
| 展开编辑 | 插代码块不再复制整份正文；光标/选区、CRLF、已有围栏、IME及大量反引号保留内容。13单测、1440/390返回刷新通过；[修复记录](expanded-code-insertion-20261027.md) |
| 提交按钮 | 主输入与展开编辑共享实际动作名称：发送/加入队列/引导；停止入口和派发逻辑保持。两尺寸真实红绿与原控件八格见[按钮对照](composer-input-controls-audit-20261027.md) |
| 模型提醒 | 普通radio及任意store更新不再误弹；power/recent使用明确操作事件、精确线程/notice、历史条件与power轮次去重。升级横幅不再被未展示的notice挡住。原hCa/YDa真实操作及本地27文件302项、3浏览器见[入口验证](model-change-notice-behavior-20261027.md) |

`@dnd-kit`依赖固定版本；官方 VSIX 未改。正式前端继续为 **HTTPS https://10.30.0.24:8484（8484）**，独立 Session 运行层 PID 2712539 保留，没有为本批替换运行层或中断 Agent。所有发送、审批和修改队列的自动化调用均在隔离 fixture 内。

## 联合验证与失败记录

本批日志在 `.dev-runtime/session-parity-batch-20261027-r3/`。首轮 `pnpm check` 通过，553文件3348项全量会话单测通过。第一组27项浏览器26通过、1项因共享fixture漏导出后的命名导入未执行；补齐`startCompositor`导入，保留原失败日志。真实主题核对还补齐rail fixture的light class/color-scheme，符合实际ThemeContext，不改产品配色。

消费端15项中最初4项失败：新IDB保存异步导致旧测试click后立即GET尚无回执；旧测试直接写全局error而非真实owner事务失败；手机浮层已迁入rail；桌面已直接显示多行却仍等待手机“还有”入口。分别改为等待精确提交成功、真实同库同owner IDB put故障和当前实际入口/结构。原正文、目标、入队参数、排序/编辑/刷新、两次steer无interrupt、124px输入及78%背景等断言保留；独立4项均转绿。

后续确认桌面attached queue的overscroll仍为contain，而原组件为auto。确定CSS反例先红后绿，仅桌面rail对齐auto，手机/详情原保护不动；真实20条自动滚动与触控继续通过。固定原生/local绘制快照证明额外坐标平移消除，但不能因此宣称全部图像像素差消除。该样式改动后重新冻结3270输入并执行最终构建、全量单测及联合回归，最终结果见下文。

`source-before.json`是初始构建起点，`source-confirmed-before.json`补真实light夹具，`source-final-before.json`再补命名导入；`source-overscroll-final-before.json`才是桌面滚动样式及消费端fixture修复后的最终输入。不能把这些起点混用。文档不计入源码冻结。

## 未闭合与下一步

- 附件两主题的永久精确像素检查仍为红灯，未删除、跳过或放宽阈值。固定native同态样本逐点颜色集合仅用于区分原生本身的边缘方差，不能覆盖未观测的本地像素。SVG的3个图角点和部分带文本PNG场景仍未闭合；实际完整composer祖先可改变attachment corner配置，孤立QueuedMessageList不是整个composer证明。
- `independent-lifecycle/run-4`的固定三态48图否定“同key复用即可恢复”；`stylesheet-auto-1`证明初始auto已采用原生世界坐标，但SVG12对采样仍各3点差。两种负结果都保留，不把任意DOM/样式重绘后的零差异当作修复。
- 正式SDK gate/family规则没有当前Session可信通道；本地pending设置接受时点不等于原recent的原生ack。已纠正入口，不把控制实验的合成flag当正式配置。
- 新的[线程设置跨页审计](thread-settings-multitab-audit-20261027.md)已复现另一页面change或仅hydrate覆盖未发送pending模型选择；仍未修复，应优先推进。已入队冻结参数及新线程创建捕获不因此改写，不能混淆两者。
- 主/展开composer全部状态、菜单与其他正文/工具/审批矩阵仍按[完整核对表](current-goal-audit-20261027.md)继续。原三十分钟renderer RSS红灯未因本批而消失；未重复长测挑选绿色结果。

## 最终门禁

最终源码下 `pnpm check` 通过（前端构建47.87秒）；会话全量553文件／3348项通过（412.39秒）。`browser-final.log`的23项与`remaining-browser.log`的14项互不重复，共37项浏览器通过。附件两项精确像素测试仍失败，另列为红灯，不能包含在37项通过中。`source-final-verification.json`确认最终冻结的3270输入无修改、新增或删除。

正式LAN只读复验在 `.dev-runtime/session-real-read-r3-20261027/`：REF_xh3_accu桌面1600×1000及手机393×852均显示历史回复和待回答问题，6条历史读取全部200，加载提示、pageerror、任务写入和横向溢出均为零。日志仍保留一条资源404及取消请求，不宣称所有网络记录无异常。原Session运行层PID2712539及启动时间保持。测试结束后关闭本批自有45439原组件参考服务，未关闭正式服务。
