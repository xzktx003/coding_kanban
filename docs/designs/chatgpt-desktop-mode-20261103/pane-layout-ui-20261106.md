# 第四模式分屏布局动作（2026-11-06）

本轮把独立 `desktop-pane-layout` 的布局动作接到 Mac 原资源适配的既有分屏边界。普通会话、终端及旧 Codex 模式不接入此状态；官方 ASAR 保持原样。

隔离原生文档的现有服务端入口为 `createChatGptDesktopSurfaceOptions({splitPane:true})`，生成 version 4 文档并选择固定 Mac page 的 `DesktopSplitPaneBoundary`。该边界在原 React root 内复用当前 GI 和原公共 composer，背景使用已捕获原 provider 上下文的只读原 transcript。普通 version 2 入口保持单 pane；HTTP 参数不能开启分屏。共享线程组合开关由独立实现管理，本轮不改变其协议。

## 用户操作

- 四向拆分沿用原有按钮；拖到窗格边缘形成左右／上下布局，拖到中心合并当前标签。
- 每个多窗格工具栏增加“移动 / 合并”选择器，可以把当前会话移到指定窗格，或将整个窗格的标签合并过去。
- 标签可拖到另一个标签之前排序；本地拖拽状态只接受已经登记的展示 key，外部拖入文本不能成为会话身份。
- 分隔条可拖动，或通过方向键、Home、End 调整，比例仍限 15–85%。
- 整组合并作为一次布局更新发布：目标已有标签顺序保留，源标签追加。源是当前窗格时保留它原选中的 key；否则不改变正在输入的目标。失效／已移除的 group id 不产生变化。

## 输入与生命周期

布局 key 不是 native thread ID，也不授予 resume、发送或审批权限。切换到另一个真实会话仍须原可信点击／键盘路由及精确原生 scope commit，等待期间旧输入租约失效。移动、合并、关闭窗格均不停止任务或发送消息。

本轮修复公共 footer 在单 pane 与分屏之间切换时的不同 React 包装结构。现在始终使用同一 Fragment 和固定 footer 子位置；显示目标名称不会重新创建原 composer。测试保留同一个 textarea DOM、原未发送草稿与唯一有效租约，覆盖拆分、尺寸变化和合并回单 pane。native GI 也保持原挂载。

预算保持原值：128 个标签、64 个窗格、深度 16、布局序列化 32 KiB，背景 provider 快照仍按既有 64 KiB／2048 节点校验。本轮布局是文档内展示状态，不添加 localStorage 自动恢复或后台会话连接。

## 验证与边界

先红后绿新增四项布局／React测试，修前复现缺少整组操作与 composer 重挂。布局及 React 30/30、原有 footer 所有权／scope／可信导航 34/34通过。固定 Mac 原件的 page adapter 与分屏模块导入 6/6通过，未使用跳过计数。检查未启动 native、连接账号或发送模型；真实原版多会话 UI／模型验收由主线程在独立候选执行。

```sh
node --test packages/chatgpt-desktop-host/test/desktop-pane-layout.test.mjs packages/chatgpt-desktop-host/test/desktop-split-pane-react.test.mjs
node --test packages/chatgpt-desktop-host/test/desktop-split-pane.test.mjs packages/chatgpt-desktop-host/test/desktop-layout-footer-ownership.test.mjs packages/chatgpt-desktop-host/test/browser-isolated-pane-navigation.test.mjs
```

原包专项另需显式提供固定 Mac page 和 modules 目录后运行 `desktop-layout-adapter.test.mjs` 与 `desktop-split-pane-import.test.mjs`；无这些输入时的跳过不能计为通过。
