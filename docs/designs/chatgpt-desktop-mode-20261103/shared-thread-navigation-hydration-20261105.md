# 共享线程的明确导航与逐回合分页

第四模式的正式共享入口仍为 `CONTAINER_SHARED_NOT_READY`。本阶段只推进固定原版和私有 daemon 的隔离验证，不连接正式 CLI，不因模式切换、刷新或后台恢复而 resume、发送或停止任务。

固定 Linux 原包的 AppHost 分页逻辑先以 `thread/turns/list` 取回合，再以 `thread/items/list` 取得各回合条目。此前共享读取门控仅允许前者，无法完成原版所需的逐回合正文读取。新增 `shared-thread-history.mjs` 供共享策略和最终 daemon 门控复用：请求必须指定精确 thread、非空 turn、1–100 条的页上限和原生方向；游标仅接受有界字符串或固定 `{type:"item",itemId}` 锚。响应必须具有有界的原生前后游标，条目数量不能超过请求页大小，每项必须属于该 turn；重复游标或异常页被拒绝。原有单次 16 MiB 响应预算不变。只读请求仍须由宿主在实际写入前核验固定账号、daemon、线程和调用范围，该模块自身不是授权来源。

明确连接仍仅允许一次 `{threadId,excludeTurns:true}`，不携带工作目录、模型、配置或权限覆盖；应保留真实响应中的分页模式、空 turns 和两个原生游标，不构造假成功。若分页能力在已写出 resume 后、回执到达前失效，最终 gate 将该结果标记为 `SHARED_DAEMON_OUTCOME_UNKNOWN`，同一 host/daemon generation/thread 不得重放。自动恢复、错误线程、重复意图和未授权 turn/start 不因分页读取放行。

## 验证

- 先红测试 `/tmp/chatgpt-shared-item-hydration-red.log` 复现逐回合分页被拒绝；`/tmp/chatgpt-shared-hydration-revoked-red.log` 复现回执前分页能力撤销却被旧 gate 接受。对应修复后，固定 Mac 资源、原 Linux wrapper/ROP、授权、分页及审批组合 **106/106 通过、0 跳过**，日志 `/tmp/chatgpt-shared-hydration-final-combination.log`；包检查日志 `/tmp/chatgpt-shared-hydration-final-check.log`。
- 同一固定源码快照的 SHA-256 清单摘要为 `77270822c662a6eb58906965286ff8212fb9f859ce5f09783903a13c213eb409`。无账号、network-none 的私有 alpha `0.166.0-alpha.5.1` 和 stable `0.166.0` 两客户端测试分别见 `/tmp/chatgpt-shared-nav-gui-alpha-final.log` 与 `/tmp/chatgpt-shared-nav-gui-stable-final.log`。Chromium 真实点击从固定 Mac 包提取的完整 `Tja` 线程行，经过原导航 provider 和固定补丁后的原 resume 表达式、一次性 view 意图及最终 gate，到自有 daemon 发出一次最小 resume；随后通过私有 authority 实际读取该 turn 的条目。自动导航、错误线程和重复意图不会写出，原 owner 的待审批与排队保持，两个客户端观察到原轮次完成。
- 浏览器测试中的外围路由状态和 AppHost 传输由夹具提供；原 ROP/Et/ye 有单独固定源码测试。测试没有实例化完整 Electron 工作区，也没有验证完整原界面的冷历史 hydration；不能据此启用正式共享。文件页授权需要真实宿主提供精确身份与执行域，原版初始化覆盖、完整事件和真实账号行为仍需各自验收。
- 多 view 隔离回归中，两个原版侧栏控件明确连接同一私有 daemon 线程后可收到事件；同一原生管理器对同一事件只处理一次，第二个视图的明确审批使原任务继续且队列保持。外层路由和尾部 hydration 仍由夹具提供，正式共享入口继续关闭。
