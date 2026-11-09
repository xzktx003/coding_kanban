# 接续 Harness 会话后的核心交付（2026-11-06）

按用户要求接续 `deepseek-harness/session-87af675b-9e9d-445d-8bc5-f88bf4f47d14`。**第四模式的原版界面、新建、真实收发、同线程中文续聊已通过。** 本轮采用完整官方 Linux 应用经 VNC 显示；Mac 1:1 和其他完整功能继续实施，不据本轮核心交付结案。

## 可用入口和操作

- LAN HTTPS：**https://10.30.0.26:8507/?mode=chatgpt&view=agent**，前端绑定 `0.0.0.0`。
- VNC Password 取自本机 owned `0600` 文件 `/data01/home/xing.hu/.cg-gui-resume-i9dte9q6/run/vnc-password`。这是独立桌面口令，勿放进 URL、源码或公开日志。
- 英文可直接点击原版 New chat，在输入框输入后点击原版发送。
- 中文和长文本：点击顶栏 **粘贴文字**，在 Clipboard 面板输入或粘贴文字，再点原版聊天输入框，按 **Ctrl+V**，核对内容后点击原版发送。该按钮只打开原 noVNC 剪贴板，不自动粘贴或发送；不要使用已撤换的 Unicode 按键入口。
- 刷新后需要再次完成 VNC 口令认证；这是重新连接当前存活桌面，不会自动发送消息。

## 真实完整收发证据

使用隔离 Chromium 经受信 CA 验证实际 LAN HTTPS 和 WSS，未设置 `ignoreHTTPSErrors` 或不安全源豁免。全部消息均在浏览器实际输入或粘贴，并点击原版发送；没有后台 RPC 代发。每轮点击前记录意图，均只点击一次，未知结果不重发。

| 检查 | 最终中文结果 |
| --- | --- |
| 官方应用 / 模型 | Linux `26.1027.51404` / `gpt-6.1-sol` |
| 原生线程 | `01a1aeea-9b00-7b40-a0cc-4e0b7c14b0d1` |
| 首轮 | 包含 200 个不同汉字、emoji 和完整中文指令；经原生剪贴板和原生 user 消息逐字节核对，未丢字 |
| 首轮回复 | `中文完整链路_2F325B` |
| 中文追问 | `请逐字重复你上一条回复，不要添加其他内容，也不要调用工具。`，未包含答案 |
| 追问回复 | `中文完整链路_2F325B` |
| 两个完成回合 | `01a1aeeb-501c-7262-b9cf-6f43fb25081f`、`01a1aeec-bee6-7983-9f0f-95e5af1eaf97` |
| 输入完整性 | 两条原生 user 消息分别为预期原文加原生尾换行，UTF-8 长度 781 / 88 字节 |
| 执行与页面 | 两次 started / 两次匹配 completed、零工具调用；两组消息与回复可见，composer 清空、灰色发送、无 Stop/Queue |

私有证据根 `/data01/home/xing.hu/.cg-core-resume-cSZ9vy`：`utf8-send-ledger.json`、`utf8-{first,second}-draft-evidence.json`、`utf8-first-native.json`、`utf8-two-turn-native-evidence.json`；发送前截图 `utf8-{first,second}-draft.png`，完成画面 `frame-18.png`。截图含真实账号侧栏，留在私有目录，不加入仓库。

最终线程完成后显式重新打开同一 LAN HTTPS 页面并认证，`frame-19.png` 保留两组原文/回复；原生进程未变、任务仍2/2，未自动发送。`utf8-final-refresh.json` 记录最终重新接入。

此前英文线程 `01a1ae9b-c1d2-7651-b715-048d1f583c44` 也完成两轮真实回复 `RESUME_CORE_547EC5CAFC`，追问未提供答案。该私有测试线程在输入控件调试后已归档，JSONL 保存在同 HOME 的 `.codex/archived_sessions/`；不是数据丢失，归档手势未核实。源 CLI 历史没有导入或归档。

中文首次尝试 `01a1aec3-22d0-7950-9eab-d90903942073` 虽有真实回复，但首轮按键输入丢字，`chinese-two-turn-evidence.json` 明确保留 `firstInputExact:false`、`chineseInputPassed:false`。其刷新恢复已通过，前后原生任务均为 2/2、没有自动新增；最终修复另建上述全新线程，不覆盖红灯。

## 最小修复与检查

- 原 noVNC 1.3 在服务器无 Notify 能力时，会将 UTF-16 字符截成低 8 位；原 x11vnc 的有限 X11 keycode 也不能支撑任意中文按键。最终采用该固定 x11vnc 已验证的 UTF-8 ClientCutText 兼容路径，保留原密码认证与 Notify 分支，不经新增 HTTP 写接口，不发送 Enter。
- `GUI_VNC_UTF8_CLIPBOARD=1` 只在服务端显式开启；仅适配固定 noVNC `core/rfb.js` 的内存副本，原始 SHA `331109966c80bef620bcd09242d43dbc05fa83cb44eba439ad20148f86aa479e`，返回 SHA `482860ab6111a3e09635c2e918a115897b81102ab8b8a7bb14988691ec287136`。未知 hash 拒绝启动适配；原资产磁盘和 Codex 应用未改。
- 单项 UTF-8 内容同时受服务器广告上限与 1 MiB 限制；原 WebSocket、消息和队列预算保持。输入无效或超限拒绝，不按成功处理。
- 曾错误认为直接 ExtendedClipboard Provide 可用；独立不同 nonce 的实际粘贴揭示旧值造成假阳性。在线复验同样在原生剪贴板字节断言失败处拦下，**零次模型发送**，见 `utf8-extended-failure.json`。最终改用不同文本验证过的兼容路径，保留首因，不重复发模型任务。
- 原浏览器夹具只等 Connected/画布尺寸便关闭，现要求非透明、非单色真实像素。代理补齐 HTTP/2 `:authority` 校验，固定 Origin、路径、私有 token 与 VNC 口令保持。
- 直接相关的前端组件红绿、代理/真实像素、broker/剪贴板协议测试及前端 TypeScript 检查已通过。命令见新组件测试、`gui-vnc-prototype/README.md`；本 shell 无全局 pnpm，类型检查使用 `apps/web` 下 `node node_modules/typescript/bin/tsc -b --pretty false`。未重复跑无变化的已通过项，原生收发另以上表为准。

## 当前运行与交付边界

- Native：`cg-gui-resume-i9dte9q6`，完整容器 ID `86bb99a813c3df9028a8b5056e09f274afd734e63c095931806fb6192b07391b`，init PID `4110788` / start ticks `297386355`。新建时分配 8 GiB、2 CPU、512 PIDs，未改存活实例的预算。无窗口管理器，root 核对窗口 PID 后将本次窗口显式调整为 `1440×1000`，未重启 native。
- 当前 broker：`cg-utf8-broker-4foiplfl-broker.service`，loopback `44113`，冻结源码与私有环境位于 `/data01/home/xing.hu/.cg-utf8-broker-4foiplfl`。适配源 SHA `4c715cc49ff5272100324042ffbf24342a702e976328e4ecaf7eeb2b5e0bef5d`。此前 44112 保留，不把 broker 进程切换描述成 native 重启。
- 前端：`cg-vnc-framefix-2cd8uok7-web.service`，冻结目录 `/data01/home/xing.hu/.cgvnc-framefix-2cd8uok7/stage`，私有配置 `c/web.env`。只改本候选固定上游，原 8484/8505/8506 和其他模式未切换。
- 通用源码位于 `apps/web/{vite.chatgpt-vnc.config.mjs,chatgpt-vnc-candidate.mjs,vnc-frame-readiness.mjs}`、`apps/web/src/chatgpt-mode/ChatgptNativeDesktopApp.tsx` 与 `packages/chatgpt-desktop-host/gui-vnc-prototype/`。均为显式 opt-in，默认 Mac 资源桥不替换；GUI 启动仍为私有手工候选。
- 临时 HOME `/dev/shm/cg-gui-resume-7dprrgq9`，未挂真实主机项目；账号是授权访问快照，不复制刷新令牌。临时单元、账号续期、机器重启和持久化恢复尚未验收。
- 参考 Mac `26.1027.61615` 的完整视觉/功能对齐、真实项目与旧 CLI 任务共享、自由分屏/公共输入、SSH/云、手机、Mac 原生输入法实机仍待后续验收。VNC 是当前核心可用候选，不据此锁定最终架构。

交付前已关闭并删除本轮自有验收浏览器容器；原生 GUI 仍为同一 PID、未 OOM，LAN HTTPS 再次经证书校验返回 200，见私有 `delivery-health.json`。原生桌面、账号副本、历史及候选前端保持运行，供用户实际使用。
