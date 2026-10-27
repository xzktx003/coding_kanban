# 模型菜单恢复默认与触控焦点

对照未修改的 VSIX 26.51007.21434 主入口 hCa/lCa/ssa/esa。原包 SHA、精确源码片段及原组件浏览器观察保存在 `.dev-runtime/session-model-menu-keyboard-20261027/`。自有宿主只提供声明的目录、设置回执及宿主存储，不连接正式账号或发送任务。

## 已定位差异

- 两侧 1440/375 CSS px、DPR 1 同条件对照：原插件主菜单 caption 后 ArrowDown 到 `Reset to default`，本地原先直接到强度控制。
- 手机真实 touch 切换 simple/advanced 及选择 radio 后，原生失焦到 BODY；本地后置 RAF 无条件将焦点移回 menu。原 ssa 没有主动 blur，两个 ViewTrack 的 inert 切换及焦点生命周期造成这个结果。修复只取消触控视图切换的额外聚焦，键盘选中行、鼠标容器焦点、Escape 回原 composer 和 owner 检查保留。

## 重置行为

主插件通过 lCa 的 `defaultOption` 传递 hCa Ln，ssa 仅在 explicit model 模式显示 Reset；其他组件直接传 `onResetToDefault` 是不同路径。恢复动作先将 selection mode 设为 default，再选择 TX 推荐的模型/强度，不更改 speed、不产生 power-commit 提醒、不添加最近记录。菜单保持 simple，键盘焦点回到 caption，Reset 随 explicit model 模式消失。

原组件实际观察：gpt-5.5/high/model → gpt-5.6-sol/medium/default，恰好一次精确 thread 的设置请求，toast/错误/额外外部请求均为零。该结果来自原组件和合成宿主回执，不是正式模型会话验收。已有 advanced Default radio 在选中时仍保持原 pair/raw effort，不能和显式 Reset 混为同一动作。

按钮沿用原包 SVG path，外层 32×32、圆角 8，内层 26×26、圆角 7，图标 16×16；hover/focus 仅内层改变背景。局域网浏览器验收入口为 HTTPS `https://10.30.0.24:8484`，端口 8484，接口使用隔离夹具。

## 红绿灯与边界

触控修复前的两项 BODY 断言均失败；修复后 375px 实际原组件对照通过，键盘和 Escape 仍通过。日志分别为 `.dev-runtime/session-model-menu-keyboard-touch-red.log`、`session-model-menu-keyboard-touch-green.log`。

Reset 缺项的模型模式与过期 owner 两项单测先红。最初另有“default 模式也应显示 Reset”的测试假设，经原包路径与真实观察证伪后改为断言不显示，不能把该假设算作产品缺陷。首次修复后的 owner 用例用已改变名称的 trigger 定位失败，改用捕获宿主模拟 owner 变化，保留失败日志。完整合并后的通过结果另行追加。

模型提醒的正式 SDK gate、原生设置 ACK、多客户端的整个模型菜单生命周期和完整主题/视口矩阵仍按当前目标审计保留，不能据这两个修复宣称整个模型系统完成。

## 独立完整 hCa 浏览器复验

永久入口为 `tests/e2e/session-model-menu-keyboard.spec.ts`，通用原组件宿主已迁入 `scripts/fixtures/session-model-menu-original/`；不再读取 `.dev-runtime` 中的脚本作为测试输入。原资源须来自固定版本的已解包 VSIX，11 份 JS/CSS 的 SHA 由 `assets-manifest.json` 严格核对，主 JS 仅在 HTTP 响应末尾追加导出，原始前缀和磁盘原包不改。夹具说明与 LAN 命令见该目录 README。

最终 `session-model-menu-keyboard-final-escape-fixed.log` 为 **3/3 通过（1.0 分钟）**，完整结果在 `.dev-runtime/session-model-menu-keyboard-20261027/final-escape-fixed/`。`summary.json` 保存五份产品源码的前后 SHA、测试和永久夹具清单、实际原资产 SHA、参数和焦点结果。1440/375 两侧均实测相同 CSS viewport（高度 900、DPR 1），每个尺寸各记录原版／本地 18 步；375 使用 Chromium 的真实 touch 事件模拟，不是物理手机验收。

| 实际动作 | 最终两侧行为 |
| --- | --- |
| Trigger Enter / Space | 打开菜单，聚焦 caption |
| Caption ArrowDown | 聚焦 Restore/恢复默认 |
| Caption Enter | 切换列表，聚焦当前模型 radio |
| Radio ArrowDown / ArrowUp | 循环导航；返回原已选项 |
| Radio Space / Enter | 选择后回 simple，键盘焦点回 caption |
| 普通 Escape | 关闭菜单并回捕获的 composer，不强行回 trigger |
| Mouse 切换／选择 | menu 保持打开，容器保焦 |
| Touch 切换／选择 | menu 保持打开，自然失焦到 BODY |
| 菜单外空白点击／tap | 命中点先经 elementFromPoint 与菜单边界确认；关闭后 BODY |
| 显式 Reset | 5.5/high/model → 5.6-sol/medium/default；原组件一次精确设置请求，本地 pending 配置接受；均无 toast，Reset 消失，键盘回 caption |

Reset 外框 32×32、SVG 16×16 和完整原 `path` 严格相等；内层 26×26 的原 CSS 提取另存 `reset-css.json`，本批不声明整个菜单像素一致。所有页面错误、外网请求尝试和任务发送 API 均为零；原设置回执、目录、账号空值和 SDK gate 都是明确合成输入，不作为正式账号、正式 gate 或真实 CLI 成功证据。

补上 tooltip 后发现并修复另一条真实差异：Reset 获得键盘焦点且提示可见时，原组件一次 Escape 同时关闭提示和菜单、回到 composer；本地最初只关闭提示，仍保留菜单与 Reset 焦点。`session-model-menu-keyboard-tooltip-escape.log` 和 `tooltip-escape-control/reset-default.json` 保留同条件反例。最终只在该 Reset 捕获路径经已有 owner/action 守卫关闭，未修改其他子菜单或全局 tooltip 语义。专项验证 focus/hover 可见、blur 移除、Escape 移除并关菜单、重新打开可见、Reset 动作后无残留；双方最终第一次 Escape 的 menu 数量均为 0、editorFocused 均为 true。

最终监测源码 SHA（其余两个文件及全部夹具见 `summary.json`）：

- `NativeModelSelector.tsx`：`40226d13d7095c9d10b61795a717d079e9ebb9e69265452d44b0a58cb540f89a`
- `NativeComposerIcon.tsx`：`95bcf3f99bb827f7520fd437331614f88170b06035ac4c5dee985f96a502835e`
- `composer-native.css`：`a00b0c280315b4b54347f16035a82a3aafe92ca2abf348363072b830f81e0efb`

探针纠错与产品红灯分开保留：旧桌面 HTML 缺少 viewport meta 的手机样本不能作为同尺寸证据；旧闭合宿主最初拒绝 Reset 的 selection-mode 持久偏好更新，静态核对原 `persisted-atom-update` / `persisted-atom-updated` 后只为该固定 key 增加合成回执；本地 Default radio 的错误 accessible-name 定位和 hover 后未经确认的 Enter 目标都已改为实际 UI 定位，不计产品缺陷。原 lCa 片段曾误匹配另一个同名 minified 片段，现按函数范围限定，正确 UTF-8 区间为 `[5275636,5275900)`，不会以旧片段支持 Reset 结论。

全部自有浏览器 context 已在 finally 关闭，未重启正式前后端／会话运行层，未访问正式 iframe、登录目录或默认 IPC。本专项未运行全仓库构建；根线程的最终联合检查单独记录。
