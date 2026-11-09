# 第四模式写前守卫的局部减耗

2026-11-06：将隔离副本中已通过回归的组合补丁合入 `packages/chatgpt-desktop-host`，仅减少每次守卫中的重复扫描、过量分配和异步文件系统往返。真实冷启动、队列积压和图片发送仍须用完整冻结源单独验收，不能由本次局部结果推定已修复。

| 源码 | 决策与保留的边界 |
| --- | --- |
| `fixed-project-mounts.mjs` / `container-service.mjs` | 仅本模块创建、冻结并登记在私有 `WeakSet` 的 owner 可省去紧邻挂载核验之前的一次重复根检查。每次挂载核验仍在实际进程根遍历前后完整检查；复制或伪造 owner 仍走独立前置核验。品牌不缓存成功结果。 |
| `persistent-history.mjs` | 已核对 held FD 身份及绝对上限后，只分配当前大小加一字节；读取中增长、FD 或路径替换仍拒绝。临时缓冲在 `finally` 清零。 |
| `profile-publisher.mjs` | 默认本地路径每次同步核对目录、held FD、公开路径和实际字节，并再次核对文件与目录；没有成功缓存。注入文件系统的测试通道保留原异步实现，发布与撤销仍有异步边界及结束后的状态复核。 |
| `container-service.mjs` / `container-host-service.mjs` | 热路径同步重读 owned `0700` tmpfs HOME 和固定 Mac 文件的当前身份，仍核对规范路径、inode、权限及 tmpfs 类型。启动时的空目录检查保持原流程。 |

固定 `fixed-project-mounts.mjs` 的源码 pin 已随实现更新；容器引用的全部九个固定源码摘要逐一匹配。默认配置、原槽位/字节预算、逐写授权、撤销与未知回执不重发的规则保持。

组合补丁 SHA-256 为 `559ca81d3a06d6d65d4378633db58d363a7417b5989fafc40cda6d4a1280d7a0`。九个合入文件逐字节等于既有 green manifest 的 candidate；既有组合记录共 98 项，96 通过、2 跳过。保留账号过量分配、Mac 同步核验和 tmpfs 身份函数缺失的先红后绿记录；增长/替换、撤销、owner 伪造及固定挂载边界均有回归。两项跳过不算原生验收，本次无源码变化后没有重复执行这些检查。

一次性守卫分段计时另以补丁 `731f082f908e9db32495a67b9fa03ab046571bfea53515a8a0b168996dbbdfb9` 加入全新私有 native，没有合入上述 canonical 源码。每 256 次输出固定数字字段 `count`、`nativeMeanMs`、`nativeMaxMs`、`hostCount`、`hostMeanMs`、`hostMaxMs`，不记录正文、路径或身份；异常不改变授权结果。已保存的十二组样本中，native 分段均值为 2.37–4.75 ms，host 分段均值为 0.30–0.59 ms，不能据此推算整条桥接的处理能力。

同一新 native 在 HTTPS 8518 的隔离界面完成两个真实项目会话共五轮收发，分屏切换后续聊正确，原 composer 清空且 Stop/Queue 结束。随后关闭自有页面并以全新浏览器 context 打开，仍出现 `BRIDGE_QUEUE_FULL / waiting_count`：32 个 port post 在途、232 个等待、最近确认距失败仅 2 ms。该候选 gateway 尚未包含本补丁，因此只能说明 native 局部减耗不足以证明整体冷开修复；下一次须使用完整组合冻结源，不能重复未改动的冷开试验。8484 已交付入口未切换。

随后完整组合及浏览器交付回执窗口也已实际冷开，仍失败；窗口生效不代表 SDK 生产请求已受控，详见[两会话冷开反例](cold-reopen-20261106.md)。不再为已有同步守卫的微任务差异启动新 native。
