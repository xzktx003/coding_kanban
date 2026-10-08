# 会话名称与输入草稿

## 已确认行为

- 已有会话名称保持固定；只有全新会话以首条消息初始化名称，手动改名优先。聊天预览、消息发送和迟到通知不能覆盖已确定名称。首条消息的默认名称压缩空白并限制为 128 字符。
- UI 仍只有一个公共输入区，但 Codex、Claude 和 ACP 的文字与附件按会话分别保存。切换、关闭再打开标签、刷新或重开浏览器后恢复；关闭标签仍只取消关注。
- 新聊天按 Agent/项目保存草稿，获得实际 session ID 后关联到该会话。创建期间切换会话不抢回当前选择，创建期间新增的输入和附件也保留。
- 提交捕获原会话、文字版本和附件 ID。成功仅清理未再次编辑的提交文字及本次附件；新增文字/附件保留。失败保持原草稿，消息回滚也只恢复原会话。
- 草稿属于当前浏览器配置目录与服务来源，设备之间独立。清除站点存储或使用其他浏览器配置目录不属于恢复范围。Bot 聊天保留原有独立实现。

## 状态与存储

`useSessionDraftStore` 是文字草稿唯一来源，localStorage 的 `kanban.session.text-drafts` 保存草稿与迁移标记。键由 Agent、ACP preset、session ID 组成；没有 ID 时用项目目录组成新聊天键。每次文字修改更新 revision，迟到提交只清理捕获的版本。

`useInputStore` / `useCCInputStore` 保留文件、技能、任务入口的兼容 API，由应用挂载后绑定当前目标，避免模块循环依赖。Composer 使用显式 owner，异步回调不在返回时重新查找输入目标。Codex 编辑器随 owner 重建，以隔离撤销历史。

`useImageAttachments` 用 IndexedDB 数据库 `kanban.session.attachments`、`drafts` object store 保存附件 ID、名称、File 字节、上传路径及状态。上传前先提交文件；上传中断后恢复为可重试错误。blob URL 只供当前页面预览，恢复时重新生成，不能作为持久身份。已上传文件继续使用原服务端上传目录与校验，不更改 Rust 协议。

每个 owner 的写入串行执行；读取失败时不把空草稿写回。存储空间不足等错误在附件区显示，可重试保存；没有保存成功的附件不能开始上传。创建会话移动附件时保留 ID，迟到上传依据 ID 找回原所属草稿；移除后迟到上传不会复活附件。

旧的 `kanban.session.input-storage` / `kanban.session.cc-input-storage` 文字只迁移一次到该 Agent 首次挂载的输入目标，无法证明旧共享输入属于哪一个历史 session，因而不会复制到多个 session。原记录保留为备份。原版附件仅在内存中，升级前已刷新丢失的附件无法从记录中恢复。

`kanban.session.names` 保存名称和来源。旧卡片 preview 可暂作 fallback；首次得到正式名称或首条历史预览后校正一次，随后固定。手动改名仍通过原后端接口保存，成功后更新本地名称。设置读取合并名称，不再清空已恢复的 Codex 名称。

## 验收

先红后绿：原实现复现 Codex/Claude 切换带入其他会话文字，以及已有标签随消息预览变化。单测进一步覆盖持久恢复、旧输入迁移、创建转移、提交版本、迟到上传、移除防复活、存储读写失败、回滚期间切换和 Claude 新聊天初始化。

`tests/e2e/session-drafts.spec.ts` 使用隔离浏览器存储，拦截所有 Agent API 与 WebSocket，不向真实 Agent 发送任务。覆盖实际公共输入、三种布局、关闭重开、刷新、原生编辑器撤销、Claude 草稿与失败归属、首条命名/手动改名、后台创建、新增附件保留、上传中刷新及重试，以及关闭整个浏览器进程后用同一临时 profile 恢复文字和文件字节。profile 在测试后删除。

局域网验收地址：**HTTPS `https://10.30.0.24:8484/?mode=session`，端口 8484**；前端监听 `0.0.0.0`，地址由当前被忽略的本地配置提供，不写入源码。测试期间未重启 Rust 运行层。

```sh
pnpm --filter web test:session
pnpm check
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https \
  PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm e2e tests/e2e/session-drafts.spec.ts \
    tests/e2e/session-composer-focus.spec.ts tests/e2e/session-composer-menus.spec.ts
```

全量会话单测的 5 项既有 ACP/终端生命周期红灯属于 [生命周期方案](session-ux-lifecycle-plan.md) 的未完成范围，不能将全量测试报告成全部通过。

### 2026-10-07 实测结果

- 与本次变更直接相关的 17 个单测文件共 66 项通过（16 文件 65 项，加 ACP 自动连接草稿转移用例 1 项）；手机侧栏/机器人导航的旧测试上下文另行复验通过。
- 11 项浏览器验收通过：7 项名称/草稿核心流程，2 项手机焦点与 WebKit 整数 scrollTop 模拟，2 项 Codex/Claude 命令菜单。全部请求为隔离 fixture。另验证关闭整个 Chromium 进程、用同一临时 profile 重开后的文字和真实图片字节恢复。
- 最新全量会话单测：325 项通过，5 项既有生命周期用例失败（共 330 项）；没有新增失败或未处理异常。该 5 项保持真实红灯，未在本次名称/草稿修复中改变 Agent/终端生命周期规则。
- `pnpm check`、收尾前端类型检查、受影响路径的 `git diff --check` 通过。`.env` 保持被 git 忽略，`.env.example` 可提交。
- HTTPS 局域网前端 `https://10.30.0.24:8484/?mode=session` 返回 200，监听 `0.0.0.0:8484`，原前端进程保留；未手动重启运行层、未提交 Git。

旧浏览器用例通过导入当前 Vite 模块实例（保留 HMR 时间戳）及显式打开关注会话修复测试假设，未降低布局/焦点断言。全量日志保存在本地 `.dev-runtime/session-drafts/`。

## 手机标签与图片上传

手机和触屏设备切换标签、恢复草稿或重建编辑器时不主动聚焦输入区；直接点击输入区仍可编辑，桌面自动聚焦保留。Codex 的被动草稿恢复同时清除 Lexical 内部选区并跳过 DOM 选区同步，防止不调用 `focus()` 仍被原生光标更新唤起键盘。

Codex/Claude 的加号菜单首项为“上传图片”，点击后同步打开原生 `image/*` 多选器，上传操作项至少 44px 高。选中的 File 立即交给点击时所属草稿的 `useImageAttachments`，沿用先保存本机字节再上传的规则；不等全部上传完成才添加附件。慢上传立即显示缩略图和状态，失败保留图片供重试；切换会话、迟到上传与刷新仍按原 owner 恢复，输入区高度保持不变。图片格式和大小沿用现有上传校验。

红灯先复现恢复非空草稿抢焦点，以及加号多图上传期间无预览；`tests/e2e/session-mobile-input.spec.ts` 覆盖触屏纵横屏切换/刷新、手动输入、桌面自动聚焦、原生图片选择、多图慢上传、单图失败重试、附件归属与刷新恢复。所有 Agent 请求使用隔离 fixture，不创建或中断真实任务。原生手机软键盘和照片库界面需真机体验，浏览器自动验收检查对应编辑焦点和文件选择事件。

2026-10-08 本次验收：6 个相关单测文件共 19 项通过；上述新用例及紧凑输入区、手机阅读焦点、命令菜单、草稿恢复共 22 项 Chromium 浏览器回归通过；`pnpm check` 通过。检查了图片入口和预览的手机截图，局域网前端及网关健康响应均为 200。WebKit 因缺少系统依赖未能启动，不能视为 Safari 或真机验收通过。日志和截图保存在被忽略的 `.dev-runtime/session-mobile-input*`。

## 子 Agent 草稿

明确允许直接输入的子 Agent 使用相同线程草稿键、附件存储与提交版本规则。主输入和检查面板共用提交锁，异步回执不能清除后续输入；结构化 Agent/角色引用独立按同一 owner 保存，提交时捕获并随队列传递。受限子线程通过主输入插入跟进指令，保持原主草稿。见 [子 Agent](session-subagents.md)。
