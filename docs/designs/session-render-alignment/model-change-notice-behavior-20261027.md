# 模型通知：实际选择入口与剩余门控（2026-10-27）

本次继续 `reverse-engineer-anything` 原包取证，修正上一轮仅根据回调重放推导“所有模型选择都提示”的过宽结论。通知 surface 的深浅主题像素对照仍有效，但不能证明入口行为。这里实际挂载官方完整 `hCa`、原 controller/editor，以及 `YDa` + 原建议菜单；原包不改，HTTP 响应只追加导出。所有输入、账号和模型目录均为隔离夹具，不连接正式 IPC、不登录、不发送 turn。

## 原包与运行证据

原始目录 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets/`：

| 资产 | SHA-256 |
| --- | --- |
| `app-initial-fee819fe4f22.js` | `460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316` |
| `app-initial-c4ebaa710049.js` | `50e2af3d8c3d0e3c52612beb2d95940cc818dfe979d6d85a9fa61af5526640bc` |
| `app-initial-41ab338a184f.js` | `c755dbca916c0f830a554fe2e3057f8642b32394bea7701338e5d506f692ad56` |

`hCa` 的 UTF-8 起点是 5280453，`tn` 定义起点 5287921；`YDa` 为 `[5443870,5451078)`。前一文档的 `tn` 5287928 是函数表达式起点，七字节差来自 `let tn=`。当前 CDP 原断点 `hCa` 位于主资产 0-based line 382 / column 20669；`YDa.me` 为 line 385 / column 6275。断点只读取真实闭包变量后恢复执行，不替换回调。

独立目录 `.dev-runtime/session-model-notice-behavior-20261027/` 保留 `harness.js`、`prelude.js`、`probe.mts`、原 RPC 激活契约、`source-ranges.json` 与 `runtime-matrix.json`。每个 case 保存 bootstrap、DOM、截图、settings 请求、实际断点变量和 committed React tree；`hCa`/controller/editor 各一个，recent 场景额外包含 `YDa` 和 `K2i`。真实菜单点击前通过原 `composer.openRecentModels` command dispatcher 打开 recent 菜单；这不是物理 Alt+M 验收，也没有直接调用选择回调。

SDK 使用原 StatsigClient，明确注入合成 gate `3727129412` 的 true/false 值、固定合成 user/stableID，关闭存储、遥测和全部外网。`power-v2-clean` 及 recent cases 记录 `Bootstrap:Recognized` 和原 `Gf` 读取结果。这证明条件分支能在原组件运行，**不证明正式账号的远端 rollout、正式 SDK 初始化生产者或默认值**。原 native transport 只连接自有无账号 RPC host；唯一写请求是固定 fixture thread 的 `thread/settings/update`，受限模型/effort/multiAgentMode/空 serviceTier 参数，合成成功响应 `{}`。

| 实际操作 | 输入/状态 | 原组件结果 | 证据目录 |
| --- | --- | --- | --- |
| 普通模型 radio | Sol 6 → 5.5，已有 turn，gate true | 设置成功；`tn` 0 次；toast 0 | `radio-v2/` |
| Power | Sol 5.6 → Terra 5.6，已有 turn，legacy | `tn` 1 次；legacy toast | `power-legacy/` |
| Power | 同上，v2 | `tn` 1 次；同数字版本，无 toast | `power-v2-clean/` |
| Power | 无 turn / latestTurn 空 / 同模型仅 effort | 无 toast | `power-empty/`、`power-no-latest/`、`power-same-model/` |
| Power | 同一 turn 再降级，再新增 turn 后降级 | 同 turn 抑制；新 turn 再提示 | `power-dedupe/dedupe.json` |
| Recent | Sol 6 → 5.5，v2 | 原 `me` 的 count=1/v2=true，成功后 v2 toast | `recent-v2-settled/` |
| Recent | 5.5 → Sol 6 | legacy 无 toast；v2 有 toast | `recent-legacy-up/`、`recent-v2-up/` |
| Recent | Sol 5.6 → Terra 5.6 | legacy 有 toast；v2 无 toast | `recent-legacy-same-version/`、`recent-v2-same-version/` |
| Recent | 无 turn | 成功改模型，无 toast | `recent-empty/` |

普通 radio 的 `onSelectModel=In` 只设置模型，`tn` 接在 `onCommitPower`；recent `me` 在 `await F(...)` 成功后检查 turnCount，没有 hCa 的 latestTurn/ref 去重。`$9t` 按模型族和数字版本比较（忽略尾部 tier）；legacy `een` 先比较版本，版本相同/未知时再按唯一 luna/terra/sol tier 排序。两条路径共用这些函数和 gate，不能把本地当前显示策略视为它们的完整替代。

夹具反例保留而不计产品失败：HTTP 原 RPC 缺 crypto secure context；首次 emit 返回 push 长度违反 void 契约；recent 缺 overlayAnchorRef 导致原建议菜单可用高度为零；首次未准入 serviceTier=null 的写请求被拒绝；500ms 时设置已更新、原异步选择尚未完成，因此无 toast，延长到 2s 才读到 `me` 与提示。`power-history-unmounted` 初始 count=null，但真实点击时 count 已为 1，不能据初始未挂投影推断原组件不会提示。

## 本地最小修复

`NativeModelSelector` 仅对强度提交和最近模型操作发一次短生命周期信号；普通 radio、Default、外部 store 更新与只读恢复不产生警告。信号捕获原 thread 和此次新 notice ID，验证 before/after 模型不同、openai provider、pending 与 notice 修订；原设置方法、待确认配置、线程隔离、错误回执保护都保留。不增写入通道、writer 或 RPC。

`ModelChangeNotice` 不再订阅任意 settings 变化。消费者只在操作时读取已有有界聊天投影，空/未知历史不提示；power 额外需要最新 turn ID，并按 turn 去重；recent 不共享 power 的 turn 去重。通过精确 notice ID 同步 claim 处理多个挂载面，使用完整 Agent 交互可见性契约，卸载立即移除监听。不保留正文、不唤醒休眠会话、不轮询或补读历史。

`ModelUpgradeBanner` 去掉旧持久切换栏的互斥：独立 toast 不应让未展示的旧 notice 永久挡住退休/升级横幅；仍按真实模型目录、用户 dismiss 和替代模型判断。实际 radio 选择退休模型后横幅重新可见；没有清空别的线程 notice。

**仍未闭合：** 本地 setter 接受的是 pending 配置，并非即时原生 settings ack。原 recent 的成功回执时点未等同；本地没有可用的正式 SDK gate 通道，本轮保留原有本地 v2 文案和模型变化提示策略，不猜 gate=false、不新增用户开关。原版 legacy/v2 的 family/version 分支与本地提示范围仍有差异，例如同版本 tier 变化。这些是继续严格行为对齐的真实缺口，不因入口修复、surface 像素一致或单测绿而消失。

## 红绿与复现

- `local-radio-red.log` / `entry-red.log`：旧 store 观察器把真实 radio 操作变成 toast，明确红灯。入口 API 新增测试的 missing-export 失败另计，不充作旧行为复现。
- `duplicate-red.log`：两个挂载面中第一面 claim 后，第二面未记住该 turn，后续同 turn 多提示；现每个可见消费者记录已观察的精确 operation/turn，再执行 claim。
- `upgrade-red.log`：真实 radio 后升级横幅被无形 notice 阻挡，1 红 / 3 绿。
- 最终 `unit-final.log` 为 **27 文件 / 302 项全绿**，`tsc-green.log` 为 web TypeScript 检查成功，`browser-green.log` 为 **3/3 通过**。浏览器仍要求原通知卡 PNG 字节完全相等，不放宽像素断言。完整页面的 operation fixture 与真实 selector 单测分开记录，不能把直接事件注入称为物理菜单点击。

`browser.log` 保留本轮浏览器夹具的首次 3 失败：新增“必须已有 turn”后完整工作台原 fixture 未声明 turn，独立组件夹具又从无 HMR 查询参数的 URL 导入了不同 Codex store。修正为捕获实际已加载模块 URL，并显式给自有 fixture 声明一轮完成历史后，原断言全绿；没有放宽可见性或历史条件。

前端 LAN `https://10.30.0.24:8484`（HTTPS :8484）；本轮原资源 server `http://10.30.0.24:40521/native-goal.html`，自有只读 HTTPS 代理 `https://10.30.0.24:37693/native-goal.html`。真实原 RPC 通过 HTTPS 夹具运行，无正式登录或 IPC。新一轮启动端口以脚本输出为准。

验收后按持有 PID、进程启动 ticks、完整 argv 和 cwd 核对，仅关闭上述两个自有 reference 服务；`reference-shutdown.json` 记录两者均已退出。正式前后端、运行层与 Agent 未重启。主线程联合验收另用其自有 reference，不依赖这些已关闭端口。


2026-10-27后续只读追踪已定位固定bootstrap、SDK gate evaluator及原provider shared-object候选。现有全窗repository缺发布者/代次且卸载留旧值，Session身份投影也不足，不能直接启用为真实目标窗口门控。静态family策略、证据和实施条件见[来源与归属](model-notice-gate-provenance-20261027.md)。
