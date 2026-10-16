# 当前增强模型菜单的宽度与动效（2026-10-16）

本批接续 [键盘／生命周期验收](model-menu-keyboard-parity-20261016.md)。只修改 `composer-native.css`，将当前产品增强菜单对齐当前官方 `lCa→uca` 分支的宽度、入场关键帧和默认 system 减动行为；没有修改组件、store、协议或其它菜单。产品为绑定 `0.0.0.0` 的 **HTTP `http://10.30.0.24:48865/`**，所有业务 API／WebSocket 使用隔离 fixture。

## 原组件与实际差异

原组件仍来自 `26.51007.21434`，与当前实装 `26.1007.21434` 核对。专用 `app-initial-f5b2ced5ef25.css` 全文件 SHA256 均为 `a87bda9db016112d1be80de0a103dc33ac770ba5b7f59a2e74ed9259fb2baff4`。完整原 Dca hook、原 React／compiler runtime、lCa／uca／OR 与既有 providers 在只读私有树中运行；焦点 effect 的注册位置仍为手工接线，不能称为完整 hCa／IDE 宿主。

| 当前增强分支 | 原组件实测／原 CSS | 修改前产品实测 |
| --- | --- | --- |
| 宽度 | `63.5 × --spacing`；4px spacing 下为 254px，min-width 0，受可用宽度及视口减 16px 限制 | 224px，min-width 224px，没有对应 max-width |
| 普通入场 | 320ms，延迟 30ms，`cubic-bezier(.23,1,.32,1)`，both | 通用 150ms、无延迟、ease、无 fill |
| 关键帧 | opacity 0→1、scale .98→1，无 slide | 通用 fade／zoom／slide |
| 减动 | 原 prop 为 true 时 `animation:none`；真实偏好元数据默认为 system | 真实系统 reduce 时全局基线把通用动画缩至 0.01ms，并非完全不遵循系统 |
| 已相同的控制 | 圆角 20px、padding 0、outer 字号／行高 16／24、blur 8px | 保持，不为本批另改 |

当前原 lCa 有两条分支：非空 `modelPickerTriggerConfig` 的增强菜单走 uca 专用 254px 样式；没有该配置时仍可走 OR 的 `w-56` 224px fallback。旧 `session-codex-model-menu-reference.spec.ts` 的私有适配器导入旧 `ps→xma` 并只传 triggerButton，旧 `_ViewPanel` 为 width 100%，不是内层把 254px 压成 224px。该旧参考不能给当前增强菜单背书；旧参考适配器尚待升级，不能把其默认跳过计为当前原包验收。

原偏好链为 hCa 的 `Vg→Wv/Hv→Tit(preference, systemPrefersReducedMotion)`，元数据 key 为 `reduced-motion-preference`，默认 system，另有 on／off。**本批只对齐当前网页默认 system；显式 on／off 的产品设置尚未实现。**

后续对 General／Appearance 的只读核对确认：当前参考与实装没有挂出减动控件，对应位置编译为 null，manifest 也没有 motion 配置贡献。三态文案属于 dormant 资源，不能登记为“产品缺少当前可达设置 UI”的 bug。底层能力仍有静态的程序化写入、VS Code globalState 持久化、matchMedia change 订阅和共享 Codex webview 根属性消费，非每线程、也不等于整个 VS Code workbench；19 函数／7 片段逐字一致、4 设置模块仅资源路径 hash 不同，25 文件重复 hash 一致。本轮没有调用设置或新增控件，完整静态证据在 `menus/reduced-motion-settings-audit/`；默认 system 的菜单 CSS 对齐不能冒充三态持久化或其它消费者全量对齐。

## 完全入场后的关闭观察

原组件只执行一轮四例：simple／advanced × reduce prop false／true。false 两例实际等待 `animation.finished`，记录 currentTime 350ms、progress 1，再经过双 RAF 才 Escape；true 两例无入场动画。关闭的 mutation 观测中，旧菜单仍 connected、data-state=closed 时已为 `animation:none`、`getAnimations=[]`，随后节点移除，最终均回私有 composer。这补齐前一轮可见后只等 180ms 的缺口，不声称 closed DOM 从未存在或整个 IDE 导航已验收。

原 probe 的 `--color-surface-elevated-secondary` 缺失导致背景透明，**不能作真实背景／完整主题 oracle**；本批保留产品既有配色。十二个实际服务的原资产前后 SHA 相同，仅 GET 静态资产，无业务、认证或执行通道。自有随机 HTTP `http://10.30.0.24:40557/` 及 runner／browser／GPU／network PID/start ticks 均核对退出，未动既有服务。

证据在忽略目录 `.dev-runtime/session-polish-round2-20261016/menus/keyboard-settled-motion-audit/`：`results.json`、`summary.json`、`static-source.json`、`installed-css-comparison.json`、`final-cleanup-check.json` 与 `findings.md`。

## 红灯、纠正与产品验证

首批四例中的两条普通模式确实复现 150ms 差异；两条声称 reduce 的用例实际 media=false，属于测试设置失效，不能作减动反例。此处 Playwright Test 顶层 `test.use({reducedMotion})` 没有进入 context options，已改为真实 `page.emulateMedia`，并在导航前和最终测量时核对 `matchMedia`。没有替换浏览器的 matchMedia、样式或动画 API。

为补足真实减动的 red control，仅反向还原本批自有 CSS 改动，先确认全文 SHA 与 round5 相同，再跑真实 media=true 的两例：旧页面的 animationName=enter、duration=0.01ms，宽 224px，两例均失败；之后恢复本批样式。前后样式与全文哈希保存在 `menus/product-motion-audit/`，没有回退其它工作。

修复后的 `animation:none` 不创建任何容器入场动画。共享无障碍基线仍保留不生效的 0.01ms longhand；初次额外要求该 longhand 必须等于 0s 的两条失败另档保留。最终以 `animationName=none`、空关键帧和实际活动动画数为零验收，不为了无效 longhand 覆盖全局无障碍基线。

首轮 16 项组合为 12 绿／4 红：390／320px 主／展开的几何断言在原生入场缩放尚未结束时测得 43.9204–43.9770px。该测试此前只等双 RAF，不能代表现在 320ms＋30ms 动画结束后的热区。修正仅让几何取样等待实际 `animation.finished` 后再双 RAF，同时保存等待前后的真实 transform／playState；44px 门槛、350ms 快速重开与 owner 换代门槛均保留，产品源码没有再改。复测记录中等待前矩阵确实小于 1、动画仍 running，结束后为 identity；不是为通过而扩大样式或放宽精度。原首轮 `round6-model-browser.log` 与全部四个失败 JSON 原样保留。

| 批次 | 结果 |
| --- | --- |
| 首批普通动效／设置失效 | `model-motion-red.log`：两普通反例成立，另两 reduce 设置无效 |
| 宽度定向反例 | `model-motion-width-red.log`：一例同时复现 224／min224 和 150ms，圆角／padding 控制相同 |
| 真实减动 red | `model-motion-valid-media-red.log`：2/2 失败，导航前／测量时均确认 media=true |
| 修复后专门浏览器 | `model-motion-final-green.log`：4/4 通过，17.0 秒，1280／390px × no-preference／reduce |
| 前端类型与生产构建 | `round6-web-build.log`：`pnpm --filter web run build` 退出 0，Vite build 45.45 秒；原有大 chunk 提示保留 |
| 相关组件单测 | `round6-model-units.log`：3 文件／42 项通过，4.72 秒 |
| 最终菜单组合浏览器 | `round6-geometry-browser.log`：3 文件／16 项通过，无跳过，1.8 分钟；普通／减动、三宽度主／展开键盘与真实 Back／另一 Dialog 锁均在同一批 |

最终永久用例为 `tests/e2e/session-model-menu-motion.spec.ts`：记录真实 CSS 关键帧、宽度与媒体状态，等待实际动画完成后 Escape，验证回焦、草稿、body 指针与禁止执行调用；先保存 JSON 再断言。普通模式测得 254px、320ms／30ms／原曲线与 .98 关键帧，减动模式为 none、无活动容器动画；四例 errors／executing 均为空。390px 是 touch-capable Chromium 模拟，不计物理手机。

最终组合的十六份行为 JSON 及六份高级菜单几何记录汇总在 `round6-browser-evidence-summary.json`，errors／executing 均为空；四组 coarse 几何全部为 44px，六组无横向溢出。1280／390px 普通入场截图已人工复核。三份相关 CSS／E2E 的 scoped Prettier 检查通过。

`round6-source-manifest.json` 相对 round5 的唯一产品源变化为该 CSS，四个 src 目录仍为 2834 文件，另记录十份 E2E；`round6-geometry-source-manifest.json` 只更新上述几何测试的哈希，产品源码相同。`round6-source-acceptance-verification.json` 重新枚举并确认这 2834 份源码、十份 E2E 与 72 个 shared 产物前后不变。不能用旧 236／38 或更早 2508／92 结果代替本批新样式验收。长期 RSS 红灯、完整认证宿主、原生跨客户端 CAS 与正式运行产物启用仍独立记录。
