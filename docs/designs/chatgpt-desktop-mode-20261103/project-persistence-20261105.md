# ChatGPT 模式的本地项目恢复

显式配置 `historyRoot` 后，受控宿主在同一个账号绑定、历史目录所有权和原容器租约下采集本地项目的受限投影。项目目录仍须属于服务端固定的 `projectRoots`，且每个真实目录须可规范解析、没有被替换。只有前一代的容器 init 和 native 均确认退出，且旧 HOME、账号、项目根和最终状态均核验通过，才封存并恢复其最终项目投影；该投影不授予新目录权限，也不启动、恢复或发送任何线程。

原 Linux 包 `app.asar` SHA-256 为 `1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e`。固定原版把 `local-projects`、`selected-project` 和 `project-order` 放在 `.codex/.codex-global-state.json`；`early-bootstrap.js` SHA-256 `466efbe496786705721ae93dd7cd2be7c08d0f760d53adf984dfde77af93fecf` 的字节偏移 101963、102269、103259 分别定义这些状态项。该文件还包含其他桌面状态，因此不能整体持久化。

宿主从当前全新私有 HOME 的固定原版状态文件做有界读取，仅持久化本地项目的 `id`、`name`、`rootPaths`、`createdAt`、`updatedAt`、顺序和本地选中项。凭据、刷新 token、队列、SQLite 和其他全局状态不写入投影。旧 owner 退出后没有可靠的最终状态核验时，旧投影保留但不会写入新 HOME。已存在的旧 historyRoot 在持有原租约且复核旧 owner 后只增加独立 `project-state` 目录，不修改旧 rollout。

远程项目、云 backing、无法识别的项目或选中项字段、未知顺序引用、未授权路径以及不安全文件均不会裁剪后覆盖旧快照。native 可在 manager 退出或崩溃后继续运行，因此不含项目内容的 pending 标记贯穿整个 native 生命周期，单次采集成功不会清除它。可明确分类为不支持的内容保留原有快照并留下 unsupported 标记；无论正常退休还是异常退出，下一代都不得把旧快照伪装成已确认的最新状态。异常只停项目采集，不停止现有 native 或其任务。

当前采集为受限的 500 ms 文件状态观察，不是原版持久化事务或跨进程原子提交。观察间隔内发生的更改若恰逢进程或主机故障，可能尚未保存；manager 停止后 native 仍可能继续修改。运行代保持 pending，状态显示 `waiting`，不把中间快照称为最终封存；旧 HOME 消失、旧格式标记、身份不符或其他无法核验的情况保留原快照并显示错误。封存文件达到 128 个时显式失败，不自动删除。云项目、全部项目附加属性、原生 SQLite 中的项目与历史线程关联及机器重启后旧 tmpfs HOME 消失的恢复仍需独立实现和验收。

`GET /api/chatgpt-desktop/status` 在身份为 ready 时包含 `projectPersistence.state`，协议值只可能为 `disabled`、`waiting`、`active`、`unsupported`、`error` 或 `unknown`；本阶段配置 historyRoot 时不会返回 `active`。它通过固定 profile 的私有 broker 执行身份核对与固定只读元数据查询，不创建 view、不操作线程；旧 broker 不支持查询时为 `unknown`。浏览器不得传入目录或状态值。前端只在第四模式可见且活跃时每 30 秒读取一次，并以 profile ID 与 generation 约束结果；隐藏后停止轮询，重新显示时立即核对。不支持、错误和未知都不会显示成已保存。

针对逻辑的最小测试位于 `packages/chatgpt-desktop-host/test/persistent-projects.test.mjs`、`persistent-history.test.mjs`、`initial-mode.test.mjs`、`control-service.test.mjs` 和 `apps/server/src/routes/chatgpt-desktop.test.ts`。原版前端在两次独立无账号、无网原生夹具中验证了本地项目三项种子的迁移和显示；那项验证使用原项目服务创建第一代项目，未证明完整正式宿主的跨代 GUI 链路。正式组合验收结果另行记录。

2026-11-05 后续无账号、无网络、无任务的正式宿主两代验证中，第一代经原版选择器添加两个独立项目并先后选中，确认取消的回执；原 native 退出后，第二代封存最终状态，原 `projectCatalog` 读回两个项目与第二个选中项，显式刷新一次后原界面显示该项目。目录预置信任，第一代侧栏直接切换因首屏加载未验；这不是 Trust 或真实账号重启验收。证据为 `/tmp/cg-project-recovery-gui-g72oa6p7/results/browser-1.json`、`browser-2.json` 和 `result-g2.json`。线上 8500 没有接入本次实现。
