# 两客户端原生审批验收

从仓库根目录执行；需要已安装的锁定依赖、Linux x86_64、Python、Node、strace 和 Chrome。CLI 与浏览器都由调用者指定，本入口不下载、发现或切换正式程序：

```sh
mkdir -p .dev-runtime/approval-native-evidence
python3 scripts/fixtures/session-approval-multiclient/acceptance.py \
  --codex /absolute/path/to/codex \
  --browser /absolute/path/to/chrome \
  --output-dir .dev-runtime/approval-native-evidence
```

每次在输出目录中新建 `0700` 私有目录，保存 `summary.json`、`browser-result.json`、`timeline.jsonl`、`native.stdout.jsonl`、provider 请求、网络审计、源文件指纹及两张截图。缺少 CLI、浏览器或输出目录直接失败，不把未运行标为通过。

执行真实未改动的 CLI 字节副本（原件可以没有执行权限），以全新 HOME、CODEX_HOME、SESSION_DATA_HOME、XDG 和工作目录启动自有 stdio app-server。复用 Goal 验收的 seccomp USER_NOTIF / connect_guard，native 及其后代只能连接本次 loopback Responses provider，不允许默认 IPC 或外网。没有 auth 复制、登录或真实模型调用。provider 从本次原生请求广告的 `exec_command` schema 核对 `require_escalated`，只提出在私有工作目录执行 `printf APPROVAL_FIXTURE_OK` 的审批。

运行当前源码的 `CodexService`、`EventHub`、Codex HTTP 路由和 EventSource 路由。浏览器加载当前实际 `ApprovalItem`、审批 store、`useSseEventBridge`、通知处理器与投递保护，通过一个自有 Vite 前端访问自有运行层；前端绑定 `0.0.0.0`，使用实际输出的 HTTP LAN URL，API 准入只允许审批和 SSE。两个独立 browser contexts 分别使用 1440×1000、393×852（触控模拟）。仅构建原生与当前组件链路，不启动完整工作台或正式 Node 网关。

断言包括：

- 两页收到完全相同的原生 thread/turn/item/requestId/requestToken；真正点击各自“允许一次”按钮。HTTP handler 入口设置一次两请求屏障，确保竞争实际发生。
- 两次 HTTP 提交只有一条实际 stdin `accept`；原生对应 `serverRequest/resolved` 一次，命令真实输出固定字符串且退出 0。陈旧请求重发返回 409，没有第二次 stdin 写出。
- B 离线并断开其真实浏览器侧 HTTP SSE socket，A 收到新原生审批期间 B 保持无卡片。B 联网后带已有 `since` 游标重连，恢复准确的新请求。
- 新请求 ID 搭配旧 requestToken 返回 409，没有 native 写入；B 真实点击批准后两页清除卡片，第二条原生命令完成。
- 当前实际服务端及浏览器加载的源码指纹在验收前后不变；无 pageerror，卡片和每个按钮均在各自视口内。
- 只关闭自有浏览器、Vite、Fastify、CodexService；从本次 strace 记录的 TID 逐一核对私有 CODEX_HOME，没有残留自有 native 任务。

stdin 观察器只转发原始 `write` 调用并记账，没有修改消息或模拟原生回执；原生 resolved/执行结果另有独立 stdout 记录。普通模型响应使用确定性 provider，不代表 ChatGPT/OAuth、模型质量、完整工作台、正式网关剪裁或物理手机已经验收。这里验证同一 Session 服务的多个网页客户端，不宣称两个独立 native writer 的跨进程原子审批保证。
