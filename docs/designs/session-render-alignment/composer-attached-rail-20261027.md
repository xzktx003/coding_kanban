# Composer 上方附着条：2026-10-27

范围：已批准的 [plan.md](plan.md) 中桌面输入框上方附着条。保留提示文字与顺序、公共输入目标、队列行为和手机悬浮适配；不改变草稿/附件持久化，不重启服务、不发送真实任务。

## 原包证据

唯一基准是本仓库原始 VSIX `26.51007.21434`，路径 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets/`，未修改官方资产。

REA 对原包连续未修改的 O8i–K6 源码切片完成静态分析：父 Evidence `ev_8c764c523284a128019e36e01d07121a74ace157c6a13b44a2fec4ab9fbe331e`，summary view `ev_068487c23a3b9238df1f4e754728fc99669bb8c1f7a673efaaff696e26410e60`。切片清单在 `.dev-runtime/session-parity-current-audit/rail-source-manifest.json`，1 个文件、12,621 text bytes、解析失败 0；分析没有执行 bundle，也不覆盖切片外的调用者或动态解析。下列实际调用链另由完整原包核对，运行几何由后述浏览器参考组件证明，不能仅凭静态切片认定组件在产品中启用。

- `app-initial-fee819fe4f22.js`，SHA-256 `460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316`。以下偏移为 UTF-8 byte：`R8i`（Item）4,529,636–4,532,258；`z8i`（容器）4,532,258；`V8i`（Target）4,533,490；`H8i`（Portal）4,533,680。
- 同资产 byte 5,666,690 定义 `wn=qe!=null`；byte 5,694,283 的 `Iya` 调用把 `wn` 纳入 `keepRailMounted`；byte 5,702,214 的主 composer 真正渲染 `G6`。普通已有会话走非 quickchat、非 expanded 的 attached 分支。容器同时接受 Target、队列、Goal 和 header，不是未使用的组件定义。
- `sites-end-resource-733bd1c6da06.js` 的 `qE`（byte 280,424）为正在运行的 diff 渲染 `Gr.Item → Gr.Row → Gr.Action`；`Gr` 导入 `_f`，主资产 byte 6,083,523 导出 `G6 as _f`。
- `app-initial-f5b2ced5ef25.css` byte 163,018 起：正常布局、连续边框、底部半径 padding 与负 margin、最后一项 4 px tuck。`app-initial-aad627bd9dff.css` 定义 inline inset 为 `4px × 3.25`，基础半径为 `1rem`；支持 superellipse 时半径乘以 1.25。
- Item 使用 150 ms grid/opacity 过渡、reduced-motion 零时长、退出时 `inert`/`aria-hidden`。其 easing `zh` 由 `app-initial-41ab338a184f.js` 的 `XD` 导出为 `gIt`，值 `[.23,1,.32,1]`。

## 修复

此前 `Composer.tsx` 把运行变更、待答、模型通知与队列放在绝对定位、4 px 间距、最大 160 px 滚动的 `session-composer-floating` 中，桌面也使用了手机浮层结构。

新增 `ComposerRail.tsx` / `composer-rail.css`，桌面改为原包的 attached 几何：13 px 水平 inset、连续外框、正常布局与 tuck。条目进入/退出遵循原包时长与 easing，退出立即不可交互；空条目不占空间，切换输入 owner 时销毁旧 rail，不保留旧目标控件。

`RunningTurnChanges` 保留当前 thread/turn 的 diff 判定和查看入口。队列可见条件提为共用函数，保留暂停、错误以及尚未发送消息的既有展示规则。队列的菜单、详情 sheet 与确认弹窗在所属 item 退出时立即关闭：Portal 不继承祖先 DOM 的 `inert`，必须额外处理。提示内容与条目顺序未调整。

手机沿用已批准的最大 `min(160px,25dvh)` 悬浮区域；正常桌面中的窄栏仍走 attached。Goal 自有组件与当前表单位置不变，本轮没有迁移整个官方 Goal/portal 状态模型。

## 红绿灯与验收

1. `ComposerRail.test.tsx` 的 3 项先以原 floating 结构/直接卸载实现运行，3 项失败；实现后验证共存顺序、退出 inert/卸载、reduced motion 转绿。
2. 加入真实队列 Portal 退出与暂停/错误可见性测试，并更新 running diff 的异步退出回归。相关 5 文件合计 **26/26 通过**。
3. 浏览器首次官方几何对照发现实现使用 22 px 半径、无 inline inset：本地 `width=600,height=100,overlap=26,radius=22px`，官方为 `574,98,24,20px`。按原包 token 修正后，600 px 与 320 px 宿主中宽度、高度、重叠、半径、定位方式均相等。
4. 实际产品路由夹具验证运行变更与 queue 共存，桌面处于正常布局且贴合输入 surface，390×844 手机保留绝对定位及高度预算。没有真实发送/停止请求。
5. `tests/e2e/session-composer-attached-rail.spec.ts` **2/2 通过**，包括原包组件真实运行几何对照；缺少 `CODEX_GOAL_REFERENCE_URL` 的跳过不计通过。前端 `tsc -p tsconfig.json --noEmit` 通过。

访问与复现：正式前端 `https://10.30.0.24:8484`（HTTPS :8484），测试使用全部 API/WS 被拦截的隔离浏览器上下文。自有只读 reference 服务绑定 `0.0.0.0`，本轮输出 `http://10.30.0.24:36555/native-goal.html`（HTTP :36555），不连接 IPC 或 Agent；端口由系统分配，验收完成后已关闭该自有夹具，复现需重新启动并采用实际输出 URL。

```sh
node scripts/codex-goal-reference-server.mjs --host 0.0.0.0 --port 0
# 使用上一命令实际输出的 LAN URL：
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
CODEX_GOAL_REFERENCE_URL=http://10.30.0.24:36555/native-goal.html \
pnpm exec playwright test tests/e2e/session-composer-attached-rail.spec.ts

pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/components/codex/composer/ComposerRail.test.tsx \
  src/session-mode/components/codex/composer/ComposerRail.queue.test.tsx \
  src/session-mode/components/codex/composer/RunningTurnChanges.test.tsx \
  src/session-mode/components/codex/composer/FollowupQueue.plugin.test.tsx \
  src/session-mode/components/codex/composer/FollowupQueue.recovery.test.tsx
pnpm --filter web exec tsc -p tsconfig.json --noEmit
```

证据边界：官方对照使用原始 G6/Item 与相同高度的行，证明容器几何，不等于整个 composer 的像素一致或完整官方会话状态机验收。未验证真实登录会话、手机实机、完整提示/Goal 共存组合。原生 fixture 最初有一次本地 React client 导出取值错误，修正夹具后才进入几何对照；该失败不计验收。

## 主线程收尾复验与产物保存

并行默认 `test-results` 曾覆盖前一批截图，主线程因此在独立输出目录补跑相同两项：**2/2 通过（10.1 秒）**。本次自有参考地址为 `http://10.30.0.24:46069/native-goal.html`，完成后已关闭 PID 4107138 的自有服务。日志 `.dev-runtime/session-multi-page-20261027/rail-browser-final.log`，图片位于其 `rail-results/` 下，包括 `rail-desktop.png`、`rail-mobile.png`、600/320 两宽度的 local/native 对照；主线程已查看桌面、手机和600宽度两张参考截图。

该对照特意只断言容器几何；独立 local/native 根的主题与背景没有统一，截图不能用于颜色或完整像素一致声明。真实产品截图验证的是桌面附着和手机悬浮预算。下一关仍需在相同宿主 token/字体/主题下核对完整行内容、提示与Goal组合。最终完整 `pnpm check` 通过，相关日志见同目录 `check-final.log`。
