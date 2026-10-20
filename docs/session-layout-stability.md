# 会话布局稳定性

## 原因与修复边界

2026-10-20 隔离浏览器在 HTTPS 局域网前端观察到：子智能体快照读取失败会把家族标为未确认，即使没有已知子 Agent，也会新增输入区上方的摘要；恢复成完整空快照后又移除。关联 CSS 同时改变输入提示的定位，因此正常 15 秒状态巡检可以造成周期性上下跳。1440×900 和 390×900 回归均在原实现测得聊天高度变化 45px，不是推测。

- 子智能体入口移入已有输入工具栏，固定宽度图标显示活动数或 `?`，无障碍名称区分确定数量与待确认。点击只打开检查列表，继续复用原有子会话详情、审批与权限边界；不会启动、停止或接管 Agent。完整空家族显示 0，失败不伪装成功，也不声称已开启子 Agent。
- 连接与项目／标签同步错误位于导航下的零高度锚点，有界浮层允许收起／展开，保留错误详情和立即重试。不加入正文 flex 高度，也不在面板外拦截指针。
- 文件树同项目刷新保留原 DOM、滚动容器、焦点和展开目录。根目录或展开目录读取失败保留最近成功快照，显式提示重试；首次加载和换项目仍加载，换项目立即移除旧文件行，避免操作旧项目。

不修改 SSE、历史同步、关注集合、草稿存储、内存回收或滚动跟随算法，不依靠刷新页面或停止 Agent。长期 renderer RSS 的未解决边界仍见 [输入响应记录](session-input-responsiveness.md) 和 [内存约定](session-memory-contract.md)。

## 验证

- `features/subagents/summary.test.tsx`：完成／未知／恢复保留同一入口，未知不显示确定零，打开检查器不改变工作区。
- `features/files/explorer/useFileTree.test.tsx`：create/remove 刷新、根／展开目录失败、重试、展开状态、原 DOM、焦点和 scrollTop、换项目隔离。原实现新增用例红灯，修复后转绿。
- `SessionWorkbench.test.tsx`：离线与同步通知、折叠、重试、恢复，草稿与同步管理器不卸载。
- `tests/e2e/session-layout-stability.spec.ts`：1440／390 宽度，真实浏览器布局与原生 EventSource；HTTP 503 和 HTTP 200 不完整快照交替恢复，聊天位置、高度、阅读 scrollTop、输入区位置及高度变化不超过 1px；草稿保留，通知出现／收起／消失不移动正文，输入工具在视口内。所有业务 API 使用隔离 fixture，无真实任务提交。
- `session-scroll-smoothness`、`session-render-recovery`、`session-subagents`、`session-subagent-identity-release` 保留滚动跟随、历史错误恢复与子线程权限回归。旧摘要定位改到工具栏，旧展开后选择子线程改为直接打开列表，再选精确子线程，权限和草稿断言保留。

复用已运行且绑定 `0.0.0.0` 的前端，以下 URL 从实际本机配置读取；本轮隔离验收地址为 `https://10.30.0.28:8484`（HTTPS）。不启动或重启正式 Agent。

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https \
PLAYWRIGHT_BASE_URL=https://10.30.0.28:8484 \
pnpm exec playwright test tests/e2e/session-layout-stability.spec.ts \
  tests/e2e/session-scroll-smoothness.spec.ts tests/e2e/session-render-recovery.spec.ts \
  tests/e2e/session-subagents.spec.ts tests/e2e/session-subagent-identity-release.spec.ts
```

浏览器测试输出保存几何 JSON 与桌面／窄屏截图。截图环境缺少中文字库，字体外观不作为通过依据；几何与无障碍名称单独断言。

本轮实测：原实现桌面／窄屏均为 **45px** 高度跳变；修复后两种宽度的聊天 y/height/scrollTop、输入容器 y/height 在四次失败／恢复切换中最大变化均为 **0px**。同步通知、离线通知及手动重试恢复也保持相同几何。文件树浏览器回归在目录响应被刻意延迟期间核对原文件节点仍连接、焦点仍在原节点、边界矩形不变。

验证过程中同时修正旧子线程夹具：工具栏直接进入列表后，原生 metadata 404 验收必须显式打开对应子线程；Goal 初始化的安全取消要求同 requestId、URL、方法、1 秒内、精确 runtimeChanged 原因与 Goal cancel/reset 栈才归为主动清理，超时／连接重置仍失败；SSE abort 只在显式刷新窗口内按只读请求归类。没有删除权限、草稿、发送目标或意外网络错误断言。

最终验证汇总：`pnpm check` 通过（shared／运行层／后端／前端类型检查与生产构建）；相关 Vitest **76 文件、452 项**通过；浏览器及配套分类断言分批覆盖 **38 项**，包含布局 2、文件树 2、滚动 7、历史恢复 2、子智能体 16、身份／权限与取消分类 9。既有构建大包警告仍存在，本次未改变打包策略。没有运行新的长期内存浸泡测试，本轮几何结论不延伸为 RSS 结论。

首轮并发浏览器验收还出现过加载骨架停留／页面导航中断；冻结前端并单 worker 重跑后未再复现，具体原因未证明，不能据此声称修复了所有加载问题。最终身份专项 9/9（46.2 秒），日志位于本机忽略目录 `.dev-runtime/session-jitter-20261020/identity-final.log`。
