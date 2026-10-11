# Codex GitHub PR 预览

原插件 `extension/webview/assets/app-initial-e98b9eaef8e3.js` 的 `xni/bri/xri/_ni/pni/D3` 和 `state-eb0c3addfea5.js` 是本实现的行为依据。PR 卡片受原生 Statsig 实验开关 `1892621033` 控制；开关未提供或关闭时不读取 GitHub MCP；可用网站宿主仍可提供一般 HTTPS 网页预览，网站能力也缺失才显示 URL 提示。不因为地址像 PR 就显示未经匹配的 PR 状态。

`NativeGithubPreviewHost` 接受明确的开关值；没有显式传输适配器时使用限定 HTTP 传输。当前页面尚未接通原生 Statsig 开关同步，因此正式页面默认关闭。受控宿主开启分支的截图验收与原生远程能力验收分别记录，不能把测试 provider 的开启值当作真实账号获得该实验能力。

## URL、工具与结果

- 输入仅接受无凭证的 HTTPS `github.com` PR 地址，owner/repository 解码后只允许字母、数字、下划线、点、连字符；编号必须是正的安全整数。允许编号前导零与 `/files` 等后续路径，展示保留原仓库大小写；读取使用小写 owner/repository。
- TS 运行层提供 `POST /api/codex/mcp/github-preview/context` 与 `/read`。context 只接受 `href`，read 只接受 `href/contextToken`；工具、server、线程、账号、fetch URL 均不可由浏览器指定。
- 从当前权威 ChatGPT 账号路由与 Codex Apps 目录选择第一个具备 GitHub `github.get_pr_info` 的 detail server，拒绝 synthetic info link。优先使用同一连接目标的 `github.fetch`，固定读取 `https://api.github.com/repos/{owner}/{repository}/pulls/{number}`；不满足目标条件时用 info 的 `pr_number/repository_full_name`。目录声明 `requires_explicit_link_id` 或 fetch 通过有效 `link_accounts` 指向 info 的另一个目标时，才补 `link_id`。
- 先解开 Codex Apps 封装，再完整检查原生 info／REST schema，包括可选字段类型；核对返回编号与可用 URL 的仓库目标。Merged 优先于 Closed，Closed 优先于 Draft，其他合法开放状态显示 Open。失败不猜测状态，仍显示“仓库 · #编号”。
- 浏览器只接收复制后的标题和生命周期状态，不接收 PR 正文、diff、评论、用户资料或 REST JSON。单标题最多 4096 字符，超预算结果视为不可用；工具元数据 `_codex_apps` 最多 16 KiB，超预算连接不可用，不截断后继续调用。这两项是本项目传输／留存预算，并非原插件 schema 的字符串上限。

## 生命周期与交互

GitHub 与 Slack 共用 `ReadOnlyMcpPreviewService` 的已验证生命周期、`createNativeMcpPreviewTransport` 的身份通知和 `NativeRichLinkPreview` 的卡片控制器。两个服务分别拥有自己的临时只读宿主，不借用 Agent 线程，不创建 Agent 轮次，不加入关注集合；不能依赖原生返回的 `source` 判断线程归属。只有服务自己创建的宿主可注销，账号变化时在途旧调用完成后再清理。目录／账号在读取前后重核，迟到结果不得进入另一个身份。

成功和失败均 stale 60 秒、非活动 gc 300 秒，有界 context／结果各 128，最多 16 个不同身份并发读取，退出释放扫描器、订阅和自己的宿主。重连／失焦不自动重复执行工具；真实目录身份变化才更新已打开卡片。

卡片保持原生 700ms 悬停、200ms 预取、上下方选择、360px／视口约束、两行正文和 300ms Motion 高度动画。Tab 进入“打开”，Escape 关闭并返回触发链接，恢复焦点不重新打开或重读；隐藏模式不处理快捷键。语言切换只更新显示文本，不更换传输身份、不关闭卡片或重新执行工具。原生 GitHub SVG、短描述内容宽度和焦点恢复均有原包浏览器证据。

## 验收边界

联调前端绑定 `0.0.0.0`，局域网入口为 **HTTP `http://10.30.0.24:8484`**。临时未修改原包参考服务为 HTTP :43831；URL 来自测试环境，未写入产品源码。

`session-codex-github-preview.spec.ts` 在 390／700 与深浅主题检查 unavailable、draft、open、closed、merged，保留双侧截图和严格正文几何／SVG 比较；另用原生 `_ni` 实测 Tab／Escape 焦点。`session-codex-github-http.spec.ts` 使用原生 fetch/EventSource、真实 Fastify 生产路由和隔离账号／工具 fixture，检查门禁关闭不请求、固定 fetch、短字段传输、缓存、账号变化及不改变关注／输入目标。它不等于真实 GitHub 远程读取验收。

**仍未完成**：真实 Statsig 开关传播；正式旧运行服务在安全窗口启用新接口。真实 GitHub 只读工具读取已在下述独立运行层验证，不等于正式页面已启用该实验功能。没有为验收重启正式运行服务或中断 Agent。普通网站／图片富预览以及其他未核对分支继续列入总体目标，不能用本卡片验收替代。

## 2026-10-11 真实连接只读验证

当前 Codex Apps 目录识别已有 GitHub 连接（91 个工具）。使用本项目 `CodexService`／`GithubPreviewService`、固定 VSIX 的原生 CLI 和独立应用数据目录，实际读取公开 PR `https://github.com/openai/codex/pull/44344`，得到标题 `Open tasks with Right from the agents overview` 与 `merged`。对照目标确为 PR；此前编号 1234 是 issue，返回不可用，保留为失败目标，不把 context 可用当作有预览数据。

日志 `/tmp/codex-live-github-readonly-pr.log` 与被忽略的 `.dev-runtime/live-github-readonly/public-preview.json` 保存本次公开字段；身份证据仅保留摘要和元数据键名。服务只创建自己的临时只读 MCP 宿主，退出调用 `close()`，没有 resume／输入／停止用户 Agent，没有登录或修改连接。此结果补齐真实工具读取边界；Statsig 开关到正式 UI 的传播、安全窗口内启用新接口仍未闭合。
