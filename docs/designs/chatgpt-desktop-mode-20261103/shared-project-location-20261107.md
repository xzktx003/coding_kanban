# 共享新聊天的运行位置选择

服务端显式共享配方增加原版运行位置菜单中的“Codex CLI（共享）”。它读取原 `ComposerScope`、当前 AppHost 项目 ID 与根目录；可信鼠标/键盘选择后，提交计算沿原 registry 取得已注册 `kanban-shared-cli`。不创建 SDK host、不改原项目记录或 feature flag，界面项目 ID 与服务端 source 项目 ID 由宿主按真实 cwd 映射。

选择仅为本地界面意图，不授予任务权限。实际 host-ready、页面激活、原项目/客户端身份必须持续有效；失效保留选择提示并阻止回落私有 local。已有线程使用原 manager host。默认配方不加载此模型。原 ASAR 不变，只适配固定 `location-menu-68c55551634b.js`，原/新 SHA 为 `33eefa8e…5556ef6a6` / `20a634c4…c5396a`，48,687 → 51,470 字节。

专项测试覆盖可信选择、原件 scope/project/root 读取、失效与跨 composer 隔离。静态 REA parent `ev_52165d5ecfd806e07e50545a5fd88f46be364e46b05afa691eab0b1c7a52f298` 为七个精确成员的 partial 图，不代表运行验收。私有红绿日志位于 `/data01/home/xing.hu/.cg-shared-selection-zncavb46/`。

真实验收仍须在完整同版候选：Add project 选择服务端允许目录 → 新聊天 → 原运行位置菜单选择共享 → 原 composer 明确发送一次 → 核对 native thread/turn 的实际 shared host、cwd、回复及清稿/Stop/Queue 结束。不能以菜单或单测通过替代真实共享收发。未知回执不重发。
