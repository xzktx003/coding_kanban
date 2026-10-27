# 展开编辑插入代码块：草稿完整性修复

2026-10-27；局域网验证地址 `https://10.30.0.24:8484`（HTTPS，8484）。属于已批准 composer v2 展开编辑能力的 bug 修复，不删除项目特有编辑功能，也不宣称完整官方 composer 已对齐。

## 复现与根因

在普通输入填写 `unique-original-draft`，打开“展开编辑”，点击“插入代码块”，切换纯文本。旧 `RichDraftEditor.tsx` 拼接为 `value + fence + value`，原正文出现两次；围栏直接跟在正文后还不是合法独立 Markdown 块。桌面 1440 和手机 390 两个真实浏览器失败用例都证实重复内容会带回主输入并在刷新后恢复。

红灯证据：`.dev-runtime/session-composer-input-audit-20261027/red-01/` 的截图、JSON 和 `red-01.log`。所有请求经过独立会话 fixture；原生任务调用 `calls=[]`，页面错误为空。失败断言明确要求原正文只出现一次，未将 fixture 定位失败计作产品红灯。

## 插入语义

- 没有已记录光标时追加；正文光标处插入空块，选中文字时包为代码正文；前后片段各保留一次。
- 围栏占独立行；使用足够长的反引号包住正文中的反引号；原草稿含 CRLF 时插入也用 CRLF，并将 textarea 的 LF 光标位置映射回原字符串。
- 在已有代码编辑器内部选择时，新代码块作为当前块后面的同级块，保留原代码，避免嵌套围栏。Ace 挂载时的未聚焦初始选区不抢占插入目标。
- 中文组合输入进行中忽略插入、代码/纯文本切换和列表格式快捷键；鼠标点击工具按钮保留原输入选区。组合提交后可以正常插入。
- 不发送消息，不改变 owner、附件或模型设置；保存继续走已有版本化文字草稿路径。

## 验证

- `RichDraftEditor.test.tsx` 原 6 个用例先全红后全绿，另补 Ace 未聚焦初始选区和 15 万段独立反引号的长选区用例。后者另取得 `RangeError` 红灯（`backticks-red.log`），改为单次迭代最大围栏长度，避免数组及函数参数展开。与 `context.test.ts` 最终联跑 **13/13** 通过，日志 `unit-final-02.log`；前端 `tsc --noEmit` 通过（`tsc-02.log`）。
- `tests/e2e/session-rich-draft-insert.spec.ts`：1440/390 两宽度实际主输入、展开编辑、Ace 代码选区、IME 组合事件保护、返回和刷新恢复，**2/2** 通过，17.3 秒；无横向溢出、无任务调用和页面错误。最终路径 `.dev-runtime/session-composer-input-audit-20261027/green-02/`。
- 浏览器通过合成 `CompositionEvent` 验证组合状态保护，未宣称操作系统中文输入法或实体手机验收。
- 仅编辑 `RichDraftEditor.tsx` 与独立测试/本文及 bug 记录；未重启正式服务、未触碰正式任务。

执行：

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts src/session-mode/components/codex/composer/v2/RichDraftEditor.test.tsx src/session-mode/components/codex/composer/v2/context.test.ts
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_FRONTEND_PROTOCOL=https PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 pnpm exec playwright test tests/e2e/session-rich-draft-insert.spec.ts --output=.dev-runtime/session-composer-input-audit-20261027/recheck --reporter=line
```
