# 文件、引用与绘图上下文的双页持久化回归

用例：`tests/e2e/session-contexts-multitab.spec.ts`。两个真实浏览器页面位于同一 origin、同一 BrowserContext，使用产品 `Composer`、`ContextAttachments`、`DrawingEditor` 及对应 store。夹具复用 `session-composer-v2-fixture`，全部 API 路由隔离，禁止任务提交、队列写入、中断、resume、fork 或删除。

最后一项消费者用例允许一次**夹具** `thread/start`，随后故意让上下文移动失败；它核对没有 `turn/start` 或 `followups/submit`，不连接真实原生运行层。

## 已复现的旧实现故障

旧 `composer/v2/drafts.ts` 每次保存把本页内存中的整个 owner 集合写到 `kanban.session.composer-v2`。两个页面分别加载后没有共同的更新基线。

`red-01` 两项真实浏览器用例都失败：

1. A 在 owner A 添加文件快照和草图，B 在 owner B 添加回答引用和草图。两个页面的上下文原先均真实可见，B 保存后 A 刷新，文件 chip 从期望 1 变为 0，owner A 的绘图也不在恢复状态中。
2. A 捕获待清理上下文；B 为同 owner 修改同一文件的路径／行号并新增引用。A 的迟到 `clearSubmitted` 运行后刷新，保留项从期望 2 变为 0。文件正文与 ID 故意不变，验证不能只比较 `id + text` 而忽略已改变的上下文元数据。

原始源码保存在 `.dev-runtime/session-contexts-multitab-20261027/red-01/drafts-before.ts`，同时保留结果 JSON、文本日志、失败 DOM 快照及两页最终 store 读取。这里的失败发生在真实上下文 DOM 断言，存储读取仅作为辅助诊断。

## 修复后的验证要求

实现改为 IndexedDB 单事务持久化；同步内存操作 API 保持，hydration／提交前持久化通过 `ensure(owner)` 与 `flush(owner)` 明确等待。`capture(owner)` 同时捕获 contexts 和可序列化的版本表，迟到清理传入两者；跨 JSON 边界也不依赖对象弱引用。因此新实现的通过结果描述为真实 IndexedDB 事务验证，不称为 localStorage 原子更新。

- 不同 owner 的文件、引用和草图刷新后均保留，身份不漂移。实际打开文件／引用预览，打开草图画布验证保存的 SVG mark；桌面及 390×844 响应式视口不得横向溢出。
- 同 owner 的迟到清理只删除捕获版本，保留另一页的新增项和已修改元数据。
- 旧 localStorage 备份只读迁移。迁移后清空上下文，再模拟旧页重写原备份并刷新，不得复活已清理内容；原备份及未提交绘图保持。
- 真实上下文“移除 → 撤销”交互不得覆盖另一页的新引用；以刷新后的 DOM 验证持久化，不把乐观 UI 当作落盘证据。
- 向移动事务的第二个 owner 执行 `IDBObjectStore.put` 时注入 `QuotaExceededError`，要求整个真实事务回滚；另页刷新后来源文件／绘图和目标原引用均保持。该故障注入不等于耗尽真实浏览器磁盘配额。
- 第一次 Undo 写入失败后，实际通知保留撤销入口；恢复存储后第二次点击须等待落盘再关闭提示，另页刷新确认恢复。
- Undo 保留 public context ID，但产生新的内部修订。A 捕获旧版本后，B 删除并通过真实 Undo 恢复；A 的迟到清理不得删除 B 恢复的新修订。
- 保留真实 move 事务，只在它已 commit 后延迟向本页交付 Promise。另一页先确认 IDB 来源已空、目标已有原快照；此时本页修改来源文件／绘图并新增目标引用，放行后应分别保留新编辑与原移动快照。重复同 pair 的 move 共享一个 Promise，只执行一次 adapter 移动。
- 实际 Composer 新聊天创建成功后，在移动到新 thread owner 的双 owner 事务中注入配额失败。关注标签和输入目标必须留在已创建的 thread，文字保留；通过真实状态面板重试保存上下文后，文件恢复，刷新仍保持目标／文字／文件。只能创建一次线程，不能为了重试保存而发送首轮任务。

测试直接调用上下文 API 构造可精确控制身份的文件／引用和迟到回调，并使用真实产品 DOM 查看与恢复；它不模拟向 Agent 发送任务。标准 API 操作后等待 `flush` 再刷新；实际 Undo 控件的持久化由产品返回的完成语义承担，测试不会在点击撤销后额外偷偷调用 flush。响应式手机视口不等于实体手机或系统键盘验收。

## 执行及证据

局域网入口：**HTTPS `https://10.30.0.24:8484`，端口 8484**，复用现有前端，不重启正式服务。每次执行使用新的批次目录，例如：

```sh
mkdir -p .dev-runtime/session-contexts-multitab-20261027/final-01
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_JSON_OUTPUT_FILE=.dev-runtime/session-contexts-multitab-20261027/final-01/result.json \
pnpm exec playwright test tests/e2e/session-contexts-multitab.spec.ts \
  --output=.dev-runtime/session-contexts-multitab-20261027/final-01/browser \
  --reporter=line,json \
  > .dev-runtime/session-contexts-multitab-20261027/final-01/run.log 2>&1
```

## 开发批次与最终边界

- `red-01`：旧实现 2 项真实失败，分别为不同 owner 被覆盖和迟到清理误删。
- `development-01`：3 项通过，覆盖迟到清理、旧备份迁移和配额失败的整事务回滚；另 2 项失败。一个是手机点击整个 tab 的中心落到独立项目详情按钮，另一个是 compact chip 的 X 按钮已隐藏，测试未走真实详情面板的移除入口。早期 finally 诊断还遮盖了首个超时位置，后续增加有界诊断和 trace 查明原因。
- `development-02`：2 项通过，分别为真实移除／撤销保留另一页新增，以及 Undo 配额失败后再次点击成功；手机 tab 手势仍失败，trace 与 `first-error.json` 证明没有原生 beforeunload 对话框。
- `development-03`：改为点击实际会话标题、核对 composer owner 后，不同 owner 的整组桌面／390×844 恢复通过，20.2 秒。没有使用 force click，也未修改产品几何。
- `development-04`：真实事务已 commit 后的移动回执交错及重复移动用例通过，13.8 秒；`committed-move.json` 保存另页读到的事务结果、最终草稿及修订身份。
- `development-05`：Undo 身份 ABA 用例通过，14.6 秒。`undo-identity.json` 显示 public ID 保持，内部修订改变，旧清理后新修订仍在。
- `development-06`：新线程恢复消费者停在旧预期文案；当前真实精确文案为“上下文保存失败，打开状态面板重试”，不记为产品故障。
- `development-07`：修正为当前精确文案后，新线程恢复消费者通过，11.7 秒。只有一次夹具 `thread/start`，实际点击状态面板“重试保存上下文”完成恢复；刷新后目标仍为 `ux-created`，文字和文件完整，无任务提交。

上述为 9 个去重场景的开发分批证据，不拼接为一次全部通过。HMR handoff 目前只有实现审查及主线程单测，不把本文件的刷新恢复测试当作真实 Vite HMR 验收。

## 最终冻结批次

`final-01` 在产品、测试和依赖源码冻结后执行，期间没有并发编译或其他浏览器批次：**9/9 通过，132.559 秒，0 skipped、0 flaky、0 unexpected**。

- 2,882 个 web、server、shared 源码／产物及本用例／helper 的前后 SHA-256 全部一致，无新增、移除或变化。
- 九项场景均运行了真实浏览器和原生 IndexedDB。跨页文件／引用／绘图身份、迟到清理、备份迁移、Undo 及配额恢复、事务已提交后的本地编辑与重复移动均通过。
- 新聊天恢复只产生一次夹具 `/thread/start`；失败及显式重试后均没有 `/turn/start` 或 `/followups/submit`。刷新后 `ux-created` 目标、文字和文件均保留。
- 桌面和 390×844 绘图恢复没有横向溢出。四张最终截图已实际查看；共保存 17 份 JSON／PNG 场景证据。

摘要：`.dev-runtime/session-contexts-multitab-20261027/final-01/summary.json`；精确源清单和一致性结果为同目录 `source-before.json`、`source-verification.json`。`result.json` 和 `run.log` 是这一轮完整执行结果，之前所有失败批次保留。专项严格 TypeScript 检查通过；因为既有 helper 使用 workspace 的 Fastify，专项配置仅为该依赖设置解析路径，不修改产品编译配置。

本批验收版本以源清单为准。若主线程随后补充新会话 cwd／目标捕获保护，须另列相应消费者复验，不自动继承这轮旧源码的通过记录。
