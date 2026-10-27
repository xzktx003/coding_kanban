# Followup 全局偏好多页字段保存修复

2026-10-27。本项只处理同源、本设备的 `mode`、`enterBehavior`、`reviewDelivery` 三个 UX 偏好，不改变线程模型设置、已入队参数、发送协议或 Agent 生命周期。问题来自[多页设置审计](thread-settings-multitab-audit-20261027.md)最后一节。

旧 Zustand persist 每次写回三字段整份快照。页面 A 选择 steer 后，仍持有旧快照的页面 B 只改 Enter 行为，也会把 mode 写回 queue。真实两页永久回归先在旧实现失败：刷新丢失 A 的 mode；另一页也没有收到偏好变化。

现在每次 setter 只同步写一个 `kanban.session.followup-settings.v1.<field>` key，值为经过枚举校验的 JSON 字符串。两个页面修改不同字段不会写同一个 key；同字段以最后一次**成功写入**为准。这是浏览器同源 localStorage 单 key 写入语义，不是跨设备同步、多个字段的事务或协议 CAS。无实际状态变化的恢复不会通知订阅者；显式同值选择仍可重试失败写入。

旧 `kanban.session.followup-settings` 整对象仅作为只读兼容备份：某字段没有新 key 时才读取该字段；初始化和 storage/focus 事件都不迁移写回整对象，也不修改原备份。新 key 优先于旧备份，所以旧页面回写备份不能覆盖已经保存的新字段。缺字段继续使用原默认 queue / enter / inline；损坏或读失败保留原数据，并保留当前页面已有值（首次加载使用默认值）和可见错误。

原生 storage 事件到达时重新读取当前 key，而非直接使用可能迟到的 newValue；恢复焦点也只读取三项元数据。写失败时当前页面继续使用用户选择，但保留最多三个待保存字段及错误；另一页更新其他字段仍能合并。Enter 设置面板显示失败原因、当前页面继续使用所选偏好的说明，以及“重试保存偏好”按钮。重试只写失败字段；成功后按当前持久值恢复其他字段，不阻止或自动触发发送。

开发 HMR 用一个共享转发引用交接有限的当前值、失败字段和错误，旧 setter 调用转到当前代；不保存操作日志，也不逐代串联转发链。dispose 移除本代 storage/focus 监听器；新代读失败不会把已经可见的选择换回默认。存储失败未恢复前，关闭页面仍可能丢失仅内存的选择，界面明确要求关闭前重试。

## 验收

证据目录 `.dev-runtime/session-followup-preferences-20261027/`：

- `red.log`：旧实现两项真实浏览器失败，包含 A/B 不同字段覆盖和跨页变化不收敛。
- `unit-final.log`：store 八项及真实 `ComposerEnterSettings` 两项，共 **10/10**；覆盖精确字段写入、只读旧备份、迟到事件、相同快照不通知、配额/读失败/损坏、同值重试与可见失败入口。
- `final-browser.log`：**4/4**，包含真实同源两页不同字段保存/刷新、同字段最后成功选择、失败本页选择不被另一页改其他字段覆盖、显式重试恢复，以及独立真实 HMR。
- `hmr-final.log`：HMR 用例追加读失败边界后单独复验通过。实际四代模块保留失败选择，旧 setter 正确转发，保存恢复后再遇 HMR 读失败仍保留当前 steer；每代只有一个 storage 和一个 focus 监听器，最后刷新仍恢复已保存值。
- `types-scoped.log`：上述 store、消费者及单测的 TypeScript 检查通过。全前端检查当时受到其他并行线程设置接线的未完成导出影响，由主线程最终联合检查；此处不声称全仓检查已通过。

双页测试导入实际生产 store，以独立 HTML 控件显示和调用公开 setter，API 请求被拦截；可见错误/重试使用真实设置组件单测。它们证明偏好持久化与消费者行为，不冒充原生发送 E2E。真实 HMR 使用独立 Vite、独立缓存及 `reloadModule`，不修改产品文件；关闭文件系统 watch 避免共享主机监听器限制，保留实际 HMR dispose/accept。所有自有浏览器和临时服务已关闭，正式服务与 Agent 未重启。

双页入口为局域网 **HTTPS `https://10.30.0.24:8484`，端口 8484**。HMR 自有前端绑定 `0.0.0.0`，实际 **HTTP LAN URL 与随机端口**保存在测试附件 `hmr-evidence`，只在测试期间存活。

```sh
pnpm --filter web exec vitest run --config vitest.session.config.ts \
  src/session-mode/stores/useFollowupSettingsStore.test.ts \
  src/session-mode/components/codex/composer/ComposerEnterSettings.test.tsx
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
  pnpm exec playwright test tests/e2e/session-followup-preferences-multitab.spec.ts \
  tests/e2e/session-followup-preferences-hmr.spec.mts --workers=1
```

主线程最终联合检查已通过：完整配置582文件3563项、构建及57项浏览器；该偏好多页/失败恢复与HMR包含于最终组，来源见[第四批](session-parity-batch-r4-20261027.md)。
