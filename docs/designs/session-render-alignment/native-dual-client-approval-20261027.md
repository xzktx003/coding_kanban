# 两个网页客户端的真实原生审批验收（2026-10-27）

本项补充完整优化目标中的多终端审批证据，没有修改生产审批语义或重启正式运行层。可复现入口与隔离要求见 [夹具 README](../../../scripts/fixtures/session-approval-multiclient/README.md)。

## 核对范围

使用未经改动的 26.51007.21434 原包 CLI 字节，实际 initialize 为 `codexia/0.162.0-alpha.17.2`，SHA256 为 `73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4`。原仓库文件没有执行权限，因此复制到本次私有目录再增加副本执行权限；两者哈希一致，原包不改。没有将其他版本或正式服务的行为推定为已验收。

以独立 `0700` HOME、CODEX_HOME、SESSION_DATA_HOME、XDG、TMP 和工作目录启动当前 `CodexService`，Node/native 启动 cwd 也为私有项目。复用既有 seccomp connect guard，native 及后代只可连接本次 `127.0.0.1` Responses provider，默认 IPC、其他 TCP 地址与外网拒绝。provider 从 native 实际广告的工具 schema 核对 `exec_command` / `require_escalated`，只提出执行 `printf APPROVAL_FIXTURE_OK` 的审批。无账号复制、凭据、OAuth 或真实模型调用。

当前 `EventHub`、Codex HTTP 路由和原生 SSE 路由经过独立 Vite 前端连接实际 `ApprovalItem`、审批 store、SSE bridge、通知处理器与投递保护。两个独立 browser contexts 分别为 1440×1000 桌面、393×852 触控尺寸模拟；没有用假 EventSource 或直接写 pending store 代替原生请求。

前端实际地址是 **HTTP http://10.30.0.24:5173/approval.html，端口 5173**，监听 `0.0.0.0`；运行层与 provider 仍仅 loopback。本次服务已关闭，后续应使用重新执行时打印的实际端口。浏览器 API 准入只允许审批与 SSE。

## 已通过的组合

1. 两页接收完全一致的原生 thread、turn、item、requestId、requestToken。各自实际点击“允许一次”；服务端在两个 HTTP handler 的入口短暂设置屏障，保证两个 POST 确实进入竞争。
2. 两个 HTTP 提交只有一条 `accept` 写入实际自有 stdin。原生准确请求的 `serverRequest/resolved` 只有一次，随后命令输出固定字符串、退出码 0；两页 pending 卡片均清除。
3. 已解决请求使用原始身份再发时返回 409，没有第二条 native 响应。
4. B 置为离线并断开其真实浏览器侧 SSE socket。A 收到另一条原生审批期间，B 保持无卡片；B 联网后沿实际 `since` 游标重连，恢复与 A 相同的新请求。
5. 新 requestId 与其他完整身份均正确、仅 requestToken 替换为上一条旧值时，服务器返回 409，没有写入 native。B 随后实际点击批准，两页收敛，第二条命令真实完成。
6. 卡片和每个实际按钮在两种视口内完整可见，pageerror 为 0。187 个实际服务端与浏览器加载源文件在验收前后指纹一致。

最终证据目录 `.dev-runtime/session-approval-multiclient-20261027/approval-7ruwv8x7/`：

- `summary.json`：`passed:true`、进程退出 0、网络/账号审计无错误；4 次自有 loopback provider 请求，无 Authorization。
- `browser-result.json`：两次精确请求、stdin 响应、409 反例、原生命令结果、initialize 版本、视口与来源边界。
- `timeline.jsonl`：两个竞争 POST、两个实际 stdin accept、原生 resolved、B 断连/带游标重连及逐按钮边界。
- `native.stdout.jsonl`、`native.network.log`、`network-decisions.jsonl`：原生协议、strace 与内核连接准入；从本次记录的 TID 核对私有 CODEX_HOME，无自有 native 任务残留。
- `source-manifest.json`、`client-{0,1}-pending.png`：实际加载源指纹与真实组件截图。

## 失败前提和验证边界

早期失败全部保留：`approval-wrqh2xc9` 的 Chrome Unix socket 临时路径太长；`approval-8kb4yzue` 将浏览器 Response 的 `status` 属性误当方法；`approval-xxex1pm0` 发现 `setOffline` 并不保证已有 SSE socket 已断；`approval-fvp3zswx` 只关闭 upstream 时直连 Vite 夹具的 browser-facing stream 未结束。这些均是夹具前提问题，未据此修改生产审批或宣称产品红灯。最终以 B 的实际 browser-facing socket 断开建立可观察网络故障，不修改 EventSource 实现或手动灌入恢复事件。

初版手机容器缺少 `border-box`，根节点 overflow 断言没有发现右侧裁剪；查看截图后修正的是夹具宿主，并增加每个真实按钮的边界断言。后续通过样本 `approval-mdztjz1i`、`approval-4jrddbyl` 保留；最终原生启动 cwd 私有化后重新完整运行，以 `approval-7ruwv8x7` 为本项交付证据。

stdin 观察只记录并透传原 `write` 调用，原生 resolved 和实际执行结果由独立 stdout 记录佐证；它没有修改 CLI、模拟回执或改变 claim 逻辑。本项证明的是同一 Session 服务的多个网页客户端，不能推导两个独立 native writer 的跨进程原子审批。测试没有运行完整工作台、正式 Node 网关剪裁、ChatGPT/OAuth、物理手机或长时资源负载。正式运行层及其任务保持不变。
