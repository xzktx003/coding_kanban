# 新聊天默认与 Agent 偏好的多页逐字段保存（2026-10-28）

[偏好多页验收](followup-preferences-multitab-20261027.md) 用逐字段保存修好了 `useFollowupSettingsStore`。同一轮的 [线程设置多页审阅](thread-settings-multitab-audit-20261027.md) 第 61 行把另外两个 store 记为"仅审阅、没有实证双页反例"：

> `useConfigStore` 是新聊天默认，`useAgentSettingsStore` 是当前 Agent/指令类型偏好；本轮仅审阅这两个 store，没有实证双页反例，不能按 grep 宣告业务故障。

本轮给出了两个 store 各自的实证反例并修复。这不是把上一轮的 grep 结论直接采信，而是先写出失败用例看到真实红灯，再改实现。

## 根因（在 zustand 源码里确认，不是推断）

`node_modules/.pnpm/zustand@5.0.11_*/esm/middleware.mjs`：

```js
const setItem = () => {
  const state = options.partialize({ ...get() });
  return storage.setItem(options.name, { state, version: options.version });
};
const savedSetState = api.setState;
api.setState = (state, replace) => {
  savedSetState(state, replace);
  return setItem();
};
```

`persist` 包装了 `api.setState`，于是**任意**一个 setter 都会把整份 state map 以单一 key 重新序列化写回。同机两个浏览器页共享一个 `localStorage`：持有旧内存 map 的页面，一次只改一个字段的保存，会把它没碰过的所有字段一起写回成旧值。

## 两个实证反例

### `useConfigStore`（新聊天默认）

红灯 6 失败 / 5 通过，关键 diff：

```
- "sandbox": "read-only"          + "sandbox": "danger-full-access"
- "approvalPolicy": "untrusted"   + "approvalPolicy": "never"
- "model": "b-model"              + "model": ""
```

用户可见后果是权限面：`sandbox` 与 `approvalPolicy` 决定下一个新聊天能碰多少磁盘和网络。A 页把权限收紧到 `read-only`/`untrusted`，B 页只换了个模型，A 页刷新后拿回 `danger-full-access`/`never`——比用户当时的选择更宽。

### `useAgentSettingsStore`（当前 Agent / 指令类型）

红灯 5 失败 / 3 通过，关键 diff：

```
- "instructionType": "project"    + "instructionType": "system"
```

`instructionType` 不是装饰：`AgentsMdView` 用它解析实际读写的文件路径，`system` → `~/.codex/AGENTS.md`（或 `~/.claude/CLAUDE.md`），`project` → `$cwd/AGENTS.md`，并直接用于 `writeFile(filePath, contentToSave)`。被静默回退后，编辑器指向用户 home 级指令文件，而标题栏仍显示另一页选的路径，保存会落到错误的文件。

## 修法

两个 store 都改为逐字段 key，和 `useFollowupSettingsStore` 同一套语义：

- `useConfigStore`：`kanban.session.codex-config-storage.v3.<field>`，12 个字段。
- `useAgentSettingsStore`：`kanban.session.agent-settings.v2.<field>`，2 个字段。

出现第三份同样的实现后，把共享语义提取到 `apps/web/src/session-mode/lib/perFieldStorage.ts`（`createPerFieldStorage` / `createStorageSync` / `oneOf` / `encode`），而不是再粘一遍。

保留的约束：

- **旧整 map 只读**。旧 key 只作为缺字段的回退来源读取，永不写回。老页面仍拥有那个 key，若我们迁移时写回，它下一次写入就会把已保存的新选择又盖回旧值。有一项专门断言写入本页字段后旧 key 字节不变。
- **逐字段校验**。只有形状仍被当前构建认识的值才被采用，否则回落默认；一个损坏字段不得抛出到初始化之外（`"gemini"` → `codex`，`"{not json"` → `system`）。
- **权限成对写**。`setAccessMode` 仍把 `sandbox` 与 `approvalPolicy` 作为一次决定一起写，拆成两个 key 不得让刷新拼出任何菜单行都产生不了的组合。
- **写失败不丢字段**。写失败的字段进入 `unsaved`，跨页 refresh 不得用存储里的旧值把它覆盖掉。
- **事件只作为触发**。`storage` 事件到达时重新读当前 key，不信任可能已经过期的 `event.newValue`。

## 边界（不要外推）

同源 `localStorage` 的逐 key 写入语义，**不是**跨设备同步，**也不是** compare-and-swap。两页写**同一个**字段仍然是最后一次成功写入生效。需要真实事务的按线程原生设置在 `useThreadModelStore`，不在本轮范围。不同设备/profile 各自保存偏好是正常边界。

## 挂载（本轮第三项红灯）

逐字段保存只有在有人监听时才真的闭合多页缺口。`startAgentSettingsSync` 写好并导出了，但没挂到 `SessionWorkbenchEffects`——这种状态下另一页的改动要等用户刷新才可见。补 `SessionWorkbenchEffects.multitab.test.tsx` 后红灯：

```
× adopts another page's Agent and instruction-scope choices while mounted
  - "instructionType": "project"  + "instructionType": "system"
  - "selectedAgent": "cc"         + "selectedAgent": "codex"
```

断言走真实 `storage` 事件而不是 mock 调用次数，所以"接到错误的 store"和"挂载了但没装监听"两种写法都会在这里失败。两个方向都反向验证过：删掉 `startAgentSettingsSync()` 这一行，用例 1 失败；把 effect 的清理函数改成空，用例 3 失败。

## 验收证据

| 项                                      | 命令                                                                                                                                                       | 结果                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `useConfigStore` 多页 + 既有默认        | `vitest run --config vitest.session.config.ts src/session-mode/components/codex/stores/useConfigStore.multitab.test.ts …/useConfigStore.defaults.test.ts`  | 2 文件 / **16 项通过**             |
| `useAgentSettingsStore` 多页 + 设备状态 | `vitest run … src/session-mode/stores/useAgentSettingsStore.multitab.test.ts src/session-mode/lib/settings.deviceState.test.ts`                            | 2 文件 / **10 项通过**             |
| 挂载接线                                | `vitest run … src/session-mode/SessionWorkbenchEffects.multitab.test.tsx`                                                                                  | **3 项通过**                       |
| 相关子树                                | `vitest run … src/session-mode/lib src/session-mode/stores src/session-mode/components/codex/stores …Effects.multitab.test.tsx …SessionWorkbench.test.tsx` | 43 文件 / **285 项通过**           |
| 会话全量                                | `vitest run --config vitest.session.config.ts`（两个 store 改完后）                                                                                        | 629 文件 / **3991 项通过**，EXIT=0 |

`settings.deviceState.test.ts` 改了一行既有断言：旧行读整 map key `kanban.session.agent-settings` 的 `.state.selectedAgent`，该 key 按设计已不存在；新行读 `…agent-settings.v2.selectedAgent`，断言的值仍是 `"cc"`，该用例另一半（不写共享设置文件的 `postNoContentWithOptions` 断言）未改。同样强度，不同 key 路径。

类型检查维持在既有的 12 项 `CodexMarkdown.tsx` `TS2322`（`@types/react` 19.1.17 与 19.2.14 双份），本轮未新增。

## 未闭合

本轮全部是 jsdom 单测，没有做真实双页浏览器复验（上一轮 followup 偏好有 4 项真实浏览器回归，这里没有对应项）。原生跨设备并发改设置、实体手机、性能预算同样不在范围内，不能把本机设置持久化的结论泛化到这些范围。
