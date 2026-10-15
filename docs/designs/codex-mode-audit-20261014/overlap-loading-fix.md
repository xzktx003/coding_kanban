# 独立 Codex 模式：同列重叠与加载修复验收

用户本轮授权修复移动端会话重叠、打开会话慢和就绪状态不准确。前一轮更广的功能补齐保持暂停，本轮不扩展附件、审批、queue/steer/replace 或会话正文协议。

## 故障与修复

1. **两个原生聊天叠在一起。** Surface 原来把同一编辑器列的所有 Webview 都绑定到一个窗口，缓存新聊天与当前历史同时可见、可交互。真实 Chromium 在 390×844 下复现了两个可见/可交互 frame；现每个窗口选择一个原始 iframe，历史身份需要匹配实际 conversation UUID。后台 frame 用 visibility 隐藏并禁止指针输入，保留父节点、contentWindow 和草稿。
2. **列复用后一直加载。** 旧的窗口→列映射没有清除，查找选中旧条目，新窗口全部隐藏。现替换同列旧绑定，原生目标 UUID 尚未出现时不显示错误聊天；UUID 出现后再展示对应窗口。
3. **页面“已连接”但所选会话未显示。** opened 只确认打开命令已接受，不能把窗口标成 ready；任意页面 ready 也不能代表当前窗口可输入。现 ready 来自原始 Webview，历史还要匹配 thread UUID；底栏区分正在加载所选会话、原生页面已加载、当前会话可输入与当前会话被占用。官方引导可显示，但不假称存在输入能力。
4. **后台关注会话争抢首屏。** 共享关注仍同步全部导航元数据，首次打开原生编辑器只对可见窗格进行，并优先当前窗口。隐藏标签在选择或进入可见分屏时再打开；已经打开的 iframe 保持挂载，不停止 Agent。
5. **正式运行版本仍含约 30 秒等待。** 当前正式宿主安装的自有伴随扩展与工作区入口不同，旧入口先等待官方激活再发布私有实例。工作区已有异步启动修复，本轮在隔离官方宿主验证后，将自有 extension.cjs 原子更新到正式宿主的安装副本。官方 VSIX、其他伴随模块、运行配置与已有扩展宿主进程不变；后续新连接加载新版入口，已有实例继续运行。

## 验收环境与范围

- 正式入口：局域网 HTTPS `https://10.30.0.24:8484/?mode=codex`，前端监听 `0.0.0.0`。
- 官方插件隔离验收：局域网 HTTPS `https://10.30.0.24:18488/?mode=codex`，前端监听 `0.0.0.0`；临时验收服务已在验证后回收；隔离网关 18282，原生宿主/伴随 broker 分别 loopback 18547/18548。使用独立项目、HOME、IPC、缓存与运行目录，沿用用户已授权的私有登录/历史视图。未发送模型任务，未接管默认 CLI IPC，也未停止正式 Agent。
- `codex-native-overlap.spec.ts` 使用真实 Chromium、生产 surface 模块与受控原生 DOM，复现同列缓存、原生嵌套 active-frame、列复用与草稿保留。这证明适配器行为，不替代用户物理手机浏览器验收。
- `native-codex-mode.spec.ts` 使用未修改的官方 VSIX，检查原生 frame 命中、模式往返保留节点、五种宽度、刷新与连接稳定；等待响应式布局稳定后截图。官方引导页面不被计为可输入。

## 截图

- [修复前同列重叠](overlap-proof/controlled-mobile-before.png)：真实 Chromium 与受控原生 DOM，两个页面同时显示。
- [修复后唯一输入框](overlap-proof/controlled-mobile-after.png)：同一缺陷条件的生产适配器回归。
- [官方插件手机宽度](overlap-proof/official-mobile.png)：真实官方插件的引导 UI，没有将它标为可输入。

## 红绿灯与结果

| 项目 | 本轮结果 |
| --- | --- |
| 同列原生缓存与当前 frame | 修复前真实浏览器 2 个可见/可交互，修复后唯一 frame；390、430、720、1440 px 通过 |
| 列复用与错误聊天保护 | 旧绑定替换；目标 UUID 到达之前零个错误 frame，到达后唯一目标；草稿、父节点、contentWindow 保留 |
| 隐藏关注延迟打开 | 原实现后台标签触发多次 resume 的失败用例保留；改为未显示时零请求，选择后打开，分屏后补开 |
| Codex 定向单测 | 14 个文件、92 项通过，包括打开命令回执后仍加载、拒绝空白/其他会话 composer，以及原生 UUID 消失时撤销就绪并隐藏 |
| 自有宿主与只读适配器 | 117 项通过 |
| Native 网关 | 31 项通过，包括同源/参数约束和 WebSocket 消息预算 |
| 真实浏览器相关回归 | 同列回归 1、外壳 8、官方插件 1，共 10 项通过；官方截图稳定性检查另行复验 |
| 跨端检查与构建 | `pnpm check` 通过，包含共享包、运行层、前后端类型检查和生产构建；保留现有大 chunk 提示 |
| 正式升级安全 | 正式 launcher/host PID 仍存活；只替换自有 extension.cjs，没有重启已有实例 |

原始日志位于被忽略的 `.dev-runtime/codex-overlap-debug-20261014/`。首次隔离 browser 失败来自验收网关遗漏 WebSocket 插件，修正验收网关后官方用例通过，未改产品代理。一次全量 check 读到了同时进行的会话 Composer 修改并报声明顺序错误，最新工作区再次 check 通过；本轮没有覆盖那份会话改动。

更广的前轮 file-picker 功能用例未纳入本轮 10 项，仍是暂停任务的待完成边界；未运行全仓 `pnpm test`，不把定向通过扩写成全产品功能闭合。

## 启动耗时与剩余限制

旧正式实例近期日志显示，伴随扩展开始激活到 eager 完成约 30 秒。这是日志区间，不是对某一个调用的精确计时。新隔离宿主的分段诊断：实例发布 70 ms，官方激活 294 ms，打开面板 119 ms。工作区的异步启动修复消除了自有启动链路额外的串行等待。

同一隔离 HTTPS 服务上的一次新浏览器上下文与一次缓存刷新测量如下，约 100 ms 采样，宿主已在运行：

| 阶段 | 新浏览器上下文 | 同上下文刷新 |
| --- | --- | --- |
| 外壳/标签可显示 | 972 ms | 545 ms |
| 原生 workbench DOM | 3724 ms | 2116 ms |
| 私有实例标记 | 6110 ms | 4029 ms |
| 原生 UI 显示 | 14502 ms | 9030 ms |

最后一行观测到官方引导 UI，未观测到输入 composer，不代表发送权限或消息投递已经验收。只有各一次样本，不报告 p95，也不是物理设备的耗时承诺。官方 workbench/Webview 首次加载仍需约 9–14.5 秒，尚未达到前一轮提出的冷 10 秒/热 5 秒目标；本轮修复启动依赖与错误窗口等待，不宣称全部启动耗时问题已闭合。已加载窗口无需重新创建 iframe，后台元数据与正文生命周期仍分离。

未做手机软键盘/物理浏览器、网络变化与长时间 RSS 稳定性验收，未用刷新或停止 Agent 制造性能结果。官方 VSIX SHA256 保持 `75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56`。

## 可复验命令

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts src/codex-mode
node --test packages/native-codex-host/test/*.test.mjs packages/native-codex-adapter/test/*.test.mjs
pnpm --filter server exec tsx --test --test-concurrency=4 src/routes/native-codex.test.ts
pnpm check
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://<LAN-IP>:<HTTPS-port> pnpm exec playwright test tests/e2e/codex-native-overlap.spec.ts
```

官方插件用例需要显式隔离宿主与 `NATIVE_CODEX_LIVE_TEST=1`；浏览器证书对照只用于验收环境，不将忽略证书作为产品修复。
