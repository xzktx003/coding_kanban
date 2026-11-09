# 持久历史：同根换代与合成续聊验收

本轮使用完整冻结代码、固定原版 CLI `0.166.0-alpha.5.1`、原 Mac 前端和隔离 Linux native。两次回复均由容器内回环 provider 返回固定合成文本；没有真实登录、外网模型请求或用户项目。未操作既有在线实例。

| 关卡 | 实际结果 |
| --- | --- |
| 第一代生成历史 | 固定原 CLI 在本次挂载的 HOME 中实际生成一轮合成对话并正常退出；未复制其他夹具的 rollout。 |
| 第一代释放 | 两个实际创建的 view 均收到精确 scope 的 viewClosed；任务完成、队列为空。宿主退役退出 0、helper 消失，native 身份仍匹配后才正常停止该自有容器。 |
| 同根第二代 | 全新 HOME/runtime 使用同一个 historyRoot，原 init 消失后通过原有所有权检查；未复制 SQLite、全局状态或登录文件。 |
| 正文 hydration | 同一第二代 HOME 的固定 CLI 先读到零回合；显式 thread/resume 后，thread/turns/list 返回原提问、精确合成回复和一个 completed 回合。该诊断 reader 正常退出，未请求新 turn。 |
| 原版页面打开 | 通过原 Open Folder 手势选择唯一新测试项目；在项目初始化、上述 hydration 和一次显式刷新后进入 Codex。关闭原版模型公告后，点击 Recents 中的历史，原生日志确认对精确原 UUID 的 thread/resume 成功，页面显示原完整提问和回复。 |
| 原版页面续聊 | 在该历史线程只实际点击一次原 Send；第二代原 CLI 记录一次 turn/start 和一次 turn/completed，回环 provider 只接受一次请求。原 rollout 最终有两次 task_started、两次 task_complete。 |
| 页面收尾 | 连续三次检查均为唯一且清空的 composer、两轮回复可见、Stop 和 Queue 不可见、无桥接错误。 |
| 最终清理 | 第二代全部 viewClosed 后再次通过任务、队列和实例身份门禁，宿主先退役退出 0，再正常停止精确自有 native。自有浏览器已停止，历史 lease 已验证释放。 |

第一轮回复为 `SYNTHETIC_HISTORY_REPLY_ONE`，续聊回复为 `SYNTHETIC_HISTORY_REPLY_TWO`。这里只验证原协议、持久挂载、页面连接和续聊行为，合成回复不代表真实模型质量或真实账号验收。

保留的首因包括：观察器夹具曾尝试在容器内替换只读 runtime 的 CLI 链接，失败时仅有 init 与 Python coordinator，未启动 display、CLI 或 native；核对历史未变后正常清理，改为在宿主准备阶段建立观察器 launcher，未放宽只读挂载。另一次驱动误用 `Send message` 标签，因未找到控件而在任何点击之前退出；确认零 turn、零 provider 请求和草稿保留后，仅对原实际 `Send` 控件执行了一次提交。

本轮 GUI 打开历史之前已有诊断性 CLI resume/hydration。因此不能据此宣布“无需诊断预热、只靠 GUI 点击即可完成全新 HOME 的冷恢复”已通过。启动图标也未被本轮产品代码修复；项目初始化、hydration 和刷新未做单因素隔离。真实账号续期、长期运行、Mac 实机和上述完整冷恢复前置仍须独立验收。

私有证据汇总包含各文件摘要：第一代 `stop-proof.json`、`manager-closed-proof.json`、`native-stopped.json`；第二代 `same-home-resume.json`、`historical-thread-clicked.json/png`、`followup-submitted.json/png`、`ui-settlement.json`、`native-completion.json` 和关闭证明。机器路径、临时控制入口、token 和部署参数不写入公共文档。
