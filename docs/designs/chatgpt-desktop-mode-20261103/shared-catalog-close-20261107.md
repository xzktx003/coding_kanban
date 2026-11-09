# 共享目录关闭页面后的取消清理

2026-11-07，隔离原版页面仅打开并关闭自身上下文后，宿主撤销。私有首因记录为 `output-reader / CONTAINER_SHARED_SOURCE_FAILED`，最后消息包含 `shared-catalog-cancel`；没有模型发送或配置修改。

Host catalog 在页面退休、读取失败或最终 ACK 后已删除 pending 项。随后到达的合法 cancel 因找不到 pending 返回 false，router 将它作为协议错误，继而关闭整个共享来源。独立测试经实际 coordinator 与 source bridge 复现同一异常。

原有 lifetime used 集合改为同样最多 8192 项的 requestId→viewId 登记。已登记的精确取消可重复清理，不产生任何输出、任务权限或请求重用；未知请求、错 view、错 profile/generation 继续拒绝。容器和账号核验先执行。账号撤销时清除登记中的 view 值并保留已用 ID 计数，后续账号观察不能接受旧取消，也不能绕过 lifetime 上限。

回归覆盖关闭页面后迟到取消、读取失败后取消、最终 ACK 后取消与新 view 继续工作；同时覆盖未知/错目标、账号撤销及重观测、8192 上限。相关检查：

```sh
node --test packages/chatgpt-desktop-host/test/shared-catalog-lifecycle.test.mjs packages/chatgpt-desktop-host/test/shared-catalog-ipc.test.mjs packages/chatgpt-desktop-host/test/container-shared-source-coordinator.test.mjs packages/chatgpt-desktop-host/test/container-shared-source.test.mjs packages/chatgpt-desktop-host/test/container-shared-account-authority.test.mjs
```

该结果证明协议修复；未修改默认 daemon。

主线程随后以三组同版修复启动全新隔离宿主 `4a556e86-fbd4-4df7-a98a-f5a07c48990f` / `e78ee72a-be80-4e84-bc08-7c7e04bf2f8e`。受信任 HTTPS 原界面打开后关闭自身上下文，原 manager 保持同一进程身份，profile 仍为 version 1，source 未 abort、账号观察仍为 revision 1，内外首因文件均未产生；第二个全新上下文成功重新进入原界面并创建原版项目。完整私有证据在 `.cg-shared-integration-9g0xlpmg/closed-first-context-verification.json` 与 `.cg-ui-8535-av3NXthY/close-reopen-v7-9g0xlpmg`。该关卡证明真实关闭/重开，不能代替共享模型收发；8484 原宿主及其任务没有被替换。
