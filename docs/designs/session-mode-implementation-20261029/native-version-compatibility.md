# 官方 daemon 的实际版本与能力准入

日期：2026-10-30。目的：连接日常已有官方服务，同时保留精确版本验证，不要求升级或重启该服务。

## 版本来自实际连接

部署预检分清三个来源：配置选定 CLI 为 0.165.0，官方共享 daemon 的实际 initialize 为 0.163.0，磁盘管理包链接为 0.166.0。运行能力以实际 initialize 为准；不能将 CLI 版本、管理包版本或请求方 `clientInfo.version` 当作运行服务版本。

旧解析仅接受 `codexia/` 开头，正式原生握手的 `Codex Desktop/0.163.0 ...` 因展示名称不同丢失版本，实时预检随即拒绝。现在 `native-version.ts` 从握手 userAgent 的首段名称/完整 semver 读取版本，支持带空格的官方显示名；不从平台说明、括号内请求方版本、误导后缀或不完整文本猜测。原有父子 writer 释放的独立精确版本规则不扩大。

## 精确能力表

| 实际 native 版本 | 共享任务/CLI/队列/MCP App/插件 | WebRTC 准入 | 证据边界 |
| --- | --- | --- | --- |
| 0.163.0 | 八项私有原生组合通过 | 已验证，明确允许 | 与正式运行中的已删除 executable SHA 一致的保留二进制；独立私有 HOME、无账号、本地 provider。真实 UI→网关→运行层→官方私有 daemon→Chromium WebRTC 另行通过。 |
| 0.165.0 | 八项私有原生组合通过 | 已验证，明确允许 | 固定 CLI 原生二进制，既有 WebRTC 实际浏览器链和本次 updater 完整回收覆盖；不外推其他发行版。 |
| 0.164.0、0.166.0、未知、预发行版本 | 未由本表宣称 | 拒绝 WebRTC 写入 | 不按大于等于版本、磁盘已有新包或类似版本扩大准入。 |

0.163.0 二进制 SHA-256：`399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215`；0.165.0：`c06a67fd8ac76508dc78bd99ce20c9f317b8d568beda59485f3f4134df9962d5`。实际运行文件与保留 0.163.0 文件只读核对一致，不复制或替换正式服务。

## 红绿灯和实际验收

1. `native-0163-realtime-mcp-baseline.log`：固定 0.163.0 私有 MCP App 通过，生产实时预检在版本门控处返回 422，复现真实差异。
2. `native-0163-protocol-readiness.log`：先独立直连该私有 native，实际 offer/SDP/sideband/typed/stop 全部成立，才将其加入精确允许表；没有伪造版本或绕过生产门控来记为产品验收。
3. `native-version-parser-red.log`、`native-0163-realtime-gate-red.log` 先复现品牌解析和旧门控；修复后 parser/严格未知版本/原生状态单测通过。未知版本不触发 realtime 写入。
4. `native-0163-eight-complete.log`：八项真实原生通过、零跳过，覆盖 CLI 同线程审批、原生队列与动作、只读恢复、MCP App、插件、实时和 updater 资源回收。
5. `native-0163-browser.log`：在隔离 HTTPS LAN 前端 **https://10.30.0.24:43025/**（绑定 0.0.0.0）运行实际 Chromium WebRTC，1 项通过，7.7 秒；固定线程、真实双方 peer、typed 输入/麦克风/扬声器/结束确认，原生夹具完整关闭。模拟浏览器麦克风，不宣称真实账号模型音频或线上 OAuth。
6. `deployment-current-parser-readonly.json`：新构建的真实 CodexService 只读连接正式 daemon，解析为 0.163.0/shared-daemon；原 socket scope、PID/start ticks 保持，未 resume/acquire/发送 turn，也未启动/停止/升级服务。
7. `runtime-native-version-full-final.log`：当前完整运行层 506 项，498 通过、8 项原生显式启用用例默认跳过、零失败；上面的原生组合是另行显式执行，不能将默认跳过计作通过。

以上日志位于忽略的 `.dev-runtime/session-full-implementation-20261029/`。资源清理边界见[原生夹具资源](native-fixture-resources.md)。该兼容证据解决当前服务版本障碍，仍不替代最终正式切换、两秒性能、30 分钟 RSS 和其他 UI 场景验收。
