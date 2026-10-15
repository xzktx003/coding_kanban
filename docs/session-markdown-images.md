# Codex 聊天 Markdown 本地图片

## 修复范围

2026-10-14，助手回复的 `![草图](/服务器绝对路径/草图.png)` 在浏览器中显示破图。浏览器把文件系统路径当成同源 URL，开发服务器返回 `200 text/html`，不是图片；同一文件通过 `/api/fs/markdown-image` 返回正确的 PNG。

对照未修改的官方 `openai.chatgpt 26.51007.21434`：`webview/assets/app-initial-41ab338a184f.js` 的 `_hi` 将 Markdown 图片交给 `Jmi`；本地图片经 `read-file-binary` 读取并转换为图片源，提供加载、失败和预览状态。本项目保留 Web 的受控 HTTP 图片读取，未修改 VSIX。

`CodexMarkdown` 在 URL hardening 前只保存本地图片原始路径，图片组件使用消息原会话的 cwd；没有原目录时拒绝读取，不回退到当前选中的另一个项目。相对路径以该 cwd 为基准，支持项目内绝对路径、`file:///`、中文及 URL 编码的文件名。越界、无效路径和远程 file authority 在前端拒绝；后端继续独立执行 realpath/符号链接边界、图片类型及 16 MiB 大小校验。

图片接近视口时按需读取，生成组件私有 Blob URL。请求、图片源及项目变化会取消旧请求、忽略迟到回执，卸载释放 URL；不将图片字节加入会话正文 store。成功后支持预览、放大、下载；失败有简洁提示和重试。用户输入中的图片 Markdown 仍按现有 `imagesAsLinks` 规则呈现。

## 红绿灯与验收

先新增复现测试，原实现为 1 通过 / 3 失败；实现后定向 5 文件共 32 项通过，覆盖路径解析、原会话目录、重试、取消和回收，以及已有用户图片和生成图片展示。后端文件读取/路径工具 21 项通过。

实际访问 **HTTPS https://10.30.0.24:8484，端口 8484**，两个浏览器场景（桌面 1440、手机 390）使用独立 HTML 页面加载真实组件与正式图片 HTTP 接口，不连接 Agent 或调用会话写入。每项验证：

- 用户草图真实解码为 1600 × 1040，PNG 242,701 字节；预览窗口位于视口内，正文无水平溢出。
- 点击放大、关闭、下载，下载内容 SHA-256 与源文件相同。
- 切换其他项目后不重读或改变原图片；越界路径无图片读取请求。
- 中文/空格/`#`/`?`/`%` 文件名的相对路径，模拟一次 503 后重试读取真实文件。
- 重复挂载/卸载，每项 8 请求（含一次模拟失败），7 Blob URL 全部回收，页面错误为零。

测试在仓库内创建独立临时图片目录，结束后仅移除自己的目录；有用户草图时使用它，否则使用自包含 PNG fixture。截图、真实图片尺寸、资源计数和内存采样保存在 `.dev-runtime/local-image-acceptance/*/`。本轮每项短时加载/复显后，桌面 JS 堆 20,371,732 → 26,994,312 字节、renderer RSS 183,680 → 278,764 KiB；手机 JS 堆 20,297,968 → 27,095,296 字节、renderer RSS 177,476 → 264,000 KiB。没有强制 GC。这些短时值及 URL 回收证据不代表长期 RSS 稳定，不能替代会话内存长测。

扩展 Markdown 回归为 49 通过 / 5 失败；5 个复制相关失败在只读 HEAD 版 `CodexMarkdown` 对照中同样失败（代码/表格复制入口的既有预期不匹配）。全项目前端 tsc 仍被未涉及的 `codex-mode` 文件 7 条类型错误阻塞，本次图片路径没有类型诊断。两者保留为验收限制，不写成全量绿色。

复验命令：

```sh
pnpm --filter web test:session src/session-mode/components/codex/presentation/CodexMarkdown.images.test.tsx src/session-mode/components/codex/presentation/chatImageSource.test.ts src/session-mode/components/codex/presentation/CodexMarkdown.file-links.test.tsx src/session-mode/components/codex/items/UserMessageItem.images.test.tsx src/session-mode/components/codex/items/NativeGeneratedImages.test.tsx
pnpm --filter server exec tsx --test --test-concurrency=4 src/routes/filesystem.test.ts src/services/file-system-utils.test.ts
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 pnpm e2e tests/e2e/session-codex-local-image.spec.ts --output=.dev-runtime/local-image-acceptance
pnpm --filter web exec tsc --noEmit -p tsconfig.json
```

LAN URL 来自当前部署，不是源码常量。浏览器测试要求已运行的 Vite 与图片网关，禁止为验收停止正式 Agent。
