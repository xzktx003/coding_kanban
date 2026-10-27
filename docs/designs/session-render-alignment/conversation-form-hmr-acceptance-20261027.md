# Owner 表单本页草稿的独立 HMR 验收

2026-10-27。永久用例为 `tests/e2e/session-conversation-form-hmr.spec.mts`。按 REA 独立问题/证据分工核对本仓库完整源码；没有重新逆向官方 VSIX，也未将仓库行为说成原生 Codex 保证。产品实现及交互规则见 [owner 审计](conversation-menu-owner-audit-20261027.md)，此文只记录独立 HMR 与页面生命周期验收。

## 最终结果

`final-02` **3/3 通过**，约 4.1 秒，0 skipped、unexpected、flaky；每组 pageerror 和任务 API 请求均为 0。两份目标源码的运行前副本 SHA 与运行后仓库 SHA 一致，三组 `sourceDrift=[]`。spec 严格 TypeScript 检查退出 0。

| 独立问题 | 有效前置与实际观察 |
| --- | --- |
| store/状态交接 | 先存在 A/B 的不同 fields、非零 revision、pending、error 与非空 receipt，再进行两次真实 Vite HMR；`useConversationFormDrafts` 实例严格相同，完整状态深比较一致，页面 token 未变 |
| 引用计数 | 更新前 retain 同一 clean owner 两次，更新后第三次 retain；调用两个旧 release 不能删除仍由新模块引用的条目，最后的新 release 才删除。真实旧 A Provider 卸载、新 B Provider 挂载后，脏 A/B 均保留；两者卸载后仍保留，显式清空后才释放 |
| beforeunload | 跟踪实际注册/移除的目标监听函数，每代恰一份。hold replacement JavaScript 响应后确认旧模块已 dispose、新代未执行，目标监听数为 0；放行后恢复为 1。向 window dispatch 可取消 beforeunload，脏/pending 状态阻止离开，显式清空后的干净状态不阻止 |
| 迟到回执 | 由真实 Provider 的 run 发起受控 Promise；HMR 后 A 有新 revision、B 有独立输入，再放行旧 A 回执，只结束原 pending，A/B 新输入均保留 |
| scope 撤销 | B 请求在飞时先 HMR，再通过实际 scope 导出函数撤销，随后放行旧回执；不调用 accepted，不清字段，记录 receipt/error 并结束 pending。旧 run 再调用时在模拟 write 回调之前拒绝，计数不增加 |
| 容量与刷新 | 真实 Provider 已挂载 A，合计建立 64 个脏条目；第 65 项拒绝，超 2 MiB 编辑提示拒绝，原 64 项完整保留，HMR 亦保留。真正 page.reload 后 store 为空、无自动挂载 owner 表单、模拟 write 次数为 0，页面 token 改变；符合“本页暂存、刷新不恢复”声明 |

这里的干净释放不意味着取消全页模块的常驻监听：当前产品模块仍注册一份无阻拦的 beforeunload 回调；实际 dispose 才移除它。测试分别核对函数数量、阻拦行为和 dispose 间隙，未将这些条件混为一谈。

## 隔离与证据边界

每组将 `conversationFormDrafts.ts` 和 `conversationOwnerFormContext.tsx` 原样复制到自有 mkdtemp 目录，只在副本末尾追加无语义注释触发更新。自有 Vite 绑定 `0.0.0.0`，本批实际入口为 **HTTP `http://10.30.0.24:5173`，端口 5173**。实际 HMR 客户端运行 `import.meta.hot.dispose`/data 交接及 accept；页面 token 不变排除了硬刷新冒充 HMR。

测试执行实际导出函数及真实 React Provider。scope、账号 store、leave guard 和 Session 可见性辅助使用仓库实际模块；账号字段是新页面的 fixture 值，不读取正式登录。仅 Sonner 宿主替换为消息记录器。旧组件与更新后新组件分别实际挂载/卸载，保留旧闭包供迟到回执验证；没有复制产品状态机实现。

这是独立开发模块的 Vite HMR 证据，不是正式 **HTTPS 8484** 页面正在更新，也不是生产打包 bundle、全应用 React Fast Refresh、官方插件、跨设备或硬刷新持久化验收。没有打开正式会话、调用真实 Git/GitHub/Agent 写操作。全部 API 被拒绝路由保护，Vite HMR WebSocket 只连接自有服务器。容量 UI 提示由实际 Sonner 调用记录验证，不是完整菜单控件像素验收；12 项 owner 菜单真实交互由另一独立批次验证。

每项 finally 中都等待 `server.close()` 并删除自己的临时目录；最终 `ownedTempDirectoriesRemaining=[]`。中断的最早试跑留下的唯一自有临时副本也已核对标记后清理，没有停止或重启正式服务。

## 源码与复现

| 目标源码 | SHA-256 |
| --- | --- |
| conversationFormDrafts.ts | `d26ce3e4fb1895362b9fce42e92766b695c3c6b3584ea6e794ab7cf46d6db44d` |
| conversationOwnerFormContext.tsx | `792a6e383352185fdc6058d895656c1c770ed803d406f5e201edd46d5c99eb80` |

证据根目录 `.dev-runtime/session-conversation-form-hmr-20261027/`：

- `final-02/run.log`、`result.json`：最终三项结果。
- `final-02/browser/*/form-hmr.json`：每次 update、dispose 间隙、完整草稿值、回执、监听计数及 reload 前后状态。
- `final-02/source-verification.json`：每项前后源码 SHA、无漂移、请求/错误、清理与最终 spec 哈希。
- `spec-types.log`：严格类型检查成功，无诊断输出。

复现命令：

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/session-conversation-form-hmr.spec.mts --max-failures=1
pnpm --filter web exec tsc --target es2022 --lib dom,dom.iterable,esnext --types node --module esnext --moduleResolution bundler --skipLibCheck --strict --noEmit ../../tests/e2e/session-conversation-form-hmr.spec.mts
```

## 失败记录与未证事项

本专项未发现产品红灯，不伪造“先红后绿修复”。初次运行被 turn 中断，没有完整结论；`development-02/03` 为临时 Vite 的 Zustand/JSX 依赖映射错误，未进入产品断言。`development-04` 首次 HMR 已通过，第二次短间隔文件变化通知未到；改用稳定写入等待和明显变化的无语义注释后通知可重复，未删除 store/状态断言。`development-05` 单项通过，`development-06` 和 `final` 三项均通过；最终 `final-02` 进一步保留了 hard reload 前真实已挂载 owner 的前置条件。最初两个 spec TS 错误仅为副本内容 map 的 unknown 推断，已用 `Record<string,string>` 收敛，没有改产品或减测试条件。

未验证浏览器关闭/崩溃后的恢复（产品不承诺）、跨页面共享表单缓冲、实体手机、性能、真实服务写入和完整生产 bundle HMR。旧 scope 对应表单缓冲被保留不代表重新获得授权；验收只证明旧操作不会被静默改绑。
