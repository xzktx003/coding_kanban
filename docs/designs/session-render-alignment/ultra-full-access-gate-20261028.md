# Ultra 推理 × 完整访问权限的确认门（2026-10-28）

官方扩展不会静默地把 `ultra` 推理和完整访问权限组合起来；我们的"模型与提供商设置"面板会。本轮按官方语义补上这道门。

## 官方契约（在 bundle 里读到的，不是推断）

`app-initial-fee819fe4f22.js` 的 `Lti`（offset 3221724）在提交 model/effort 之前判一次：

```js
if (!b || t !== `ultra` || s.reasoningEffort === `ultra`) return c(), l(e, t, i);
let d = p();
return new Promise((n, r) => {
  let o = !1,
    s = () => {
      o = !0, c(), l(e, t, i).then(n, r);
    };
  Gx(a, Pti, {
    canContinue: d != null,
    onClose: () => { o || n(!1) },
    onContinueWithFullAccess: s,
    onContinueWithFallback: () => { d != null && (v(d), s(…
```

其中 `b` 来自同一函数：

```js
y = f === `full-access` && (_ == null || _.startsWith(`:`));
```

`{agentMode: f, getNonFullAccessFallbackMode: p, permissionProfileId: _, setAgentMode: v}` 由 `$Xr(d)` 提供。

两点由此确定，不需要猜：

1. **三个出口，不是两个。** `Pti`（offset 3217222）的按钮是 `onContinueWithFullAccess`（"Use Full access"）、`type:"submit"` 且 `disabled: !canContinue` 的 `onContinueWithFallback`（"Continue"），以及 `onClose`。`onClose` 里 `o || n(!1)`——没点过任何继续按钮就 resolve `false`，**什么都不写**。
2. **fallback 先改权限，再应用。** `onContinueWithFallback` 是 `d != null && (v(d), s())`：先 `setAgentMode(fallback)`，再走和 full-access 分支同一个 `s`。

`canContinue` 为假时 `Pti` 换一段文案（`noFallbackDescription`），并把 "Continue" 置灰。`d` 来自 `getNonFullAccessFallbackMode`，它读 `preferred-non-full-access-agent-mode-by-host-id`（offset 2916530）这个存储偏好，没有就返回 null。

## 我们这边为什么可达（这一点需要先解决一个表面矛盾）

既有的一条分级断言说 ultra 是**隐藏**的：

```
✓ shows seven explicitly enabled ordinary efforts with ultra hidden and ArrowRight moves medium to high
```

这条断言仍然成立，而且本轮必须让它继续成立。它管的是**原生触发器**那条路：`ordinaryNativePickerModels.ts:20` 只有一个生产调用点，写死 `includeUltra: false`，`nativePickerEffortProjection.ts` 据此把 `ultra` 过滤掉。

但面板是另一条路。`ModelReasonSelector`（`mode="panel"`，挂在 Composer 的"模型与提供商设置"里）直接渲染 `ReasoningEffortSelector`，后者走 `nativeReasoningOptions`，而它的允许集合 `PICKER_REASONING_EFFORTS` **包含 `ultra`**：

```ts
const PICKER_REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
```

所以在完整访问权限下，用户能在面板里把推理强度一路推到 ultra，没有任何提示。需要补门的是面板这条路，不是触发器那条路。

## 修法

- `ultraFullAccessGate.ts`：`needsUltraFullAccessConfirmation()` 一个纯函数承载判定，对应官方三个 arm。我们没有 permission profile 概念，所以 `b` 退化为 sandbox 判断。
- `NativeUltraFullAccessConfirmation.tsx`：对应 `Pti`。返回 `"full-access" | "fallback" | "dismiss"` 而不是 boolean——官方是三出口，boolean 承载不了。`fallbackMode` 为 null 时换 `noFallbackDescription` 文案并置灰"继续"，和 `canContinue` 一致。
- `ModelReasonSelector.tsx`：门放在这里而不是 `BaseModelSelector`。后者没有任何权限状态，sandbox 只在 `useThreadModelSettings` 这一层拿得到，所以用 `applyReasoningEffort` 包住 `setReasoningEffort`，两个渲染出口（panel 与 popover）都走它。

### 两处有意的偏离，都写在代码注释里

**`permissionsKnown` 是判定的一部分。** 权限未确认时不发问。未确认不等于 full access，也不等于安全——它就是未知。Composer 其余部分一律拒绝把未知权限渲染成确定值（`AccessModePopover` 的 `label` 在 `!permissionsKnown` 时显示"权限待确认"），这里沿用同一条规则，而不是拿一个可能过期的 sandbox 值去猜。

**fallback 固定为 `workspace-write`。** 官方读存储偏好，我们没有这个偏好。选 `workspace-write` 的理由是它正是我们权限菜单默认行（"请求批准"）产生的模式；若选一个菜单产生不了的值，刷新后会拼出菜单任何一行都造不出的组合。`setAccessMode` 内部按 `SANDBOX_APPROVAL_MAP` 成对写 `approvalPolicy`，所以 `workspace-write` → `on-request` 是一次决定，不是两次独立写入——有一条断言专门盯这一对。

## 边界（不要外推）

这是**本地写入前的本地确认**，不是原生权限准入。点"继续使用完整访问权限"不会向运行层申请任何额外能力，只是放行一次本地 effort 写入。取消必须让已保存的 effort 原样不动——不是回落到某个"安全"值，那会变成一次用户没做过的选择。

## 红绿灯

先红后绿。红灯 4 失败 / 2 通过，四条失败全部是 `Unable to find role="dialog"`，两条通过的是否定对照（full access 关闭、从 ultra 往下调）。

两个方向都反向验证过，不是只看绿：

| 探针                                 | 预期                           | 实测              |
| ------------------------------------ | ------------------------------ | ----------------- |
| 判定直接 `return false`（门失效）    | 四条门用例失败，否定对照仍通过 | 4 失败 / 2 通过 ✓ |
| 判定直接 `return true`（门过度触发） | 否定对照失败                   | 4 失败 / 8 通过 ✓ |

**过度触发探针查出了我自己测试里的一个缺陷**，值得记下来：当时那条用例叫"does not ask when the saved effort is already ultra"，在门过度触发时**仍然通过**。原因是它按 ArrowLeft，`nextEffort` 是 `high`，在官方第一个 arm（`t !== "ultra"`）就返回了，根本没碰到它声称覆盖的 `currentEffort === "ultra"` arm。面板滑块永远不会发出与当前值相同的档位，所以那个 arm 从这个界面到不了。处理方式是把用例改名为它**实际**断言的内容（"does not ask when lowering the effort away from ultra"），再在 `ultraFullAccessGate.test.ts` 里直接对判定函数补上那个 arm。改名不是放宽断言：改名后它仍然在"门失效"探针下失败，而新增的 helper 用例在"过度触发"探针下失败。

## 验收证据

| 项                     | 命令                                                                                                                          | 结果                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 两个新文件             | `vitest run --config vitest.session.config.ts …/ultraFullAccessGate.test.ts …/ModelReasonSelector.ultra-full-access.test.tsx` | 2 文件 / **12 项通过**                        |
| ultra 隐藏断言未被破坏 | `vitest run … …/NativeModelSelector.effort-filter.test.tsx`                                                                   | **5 项通过**，含 `… with ultra hidden …`      |
| composer 子树          | `vitest run … src/session-mode/components/codex/composer`                                                                     | 101 文件 / **911 项通过**                     |
| 类型检查               | `tsc --noEmit -p tsconfig.json`                                                                                               | 12 项，全在 `CodexMarkdown.tsx`，与改动前一致 |

Prettier：新增的 4 个 TS/TSX 文件全部通过。`native-full-access-confirmation.css` 在 HEAD 就已经不通过（`git show HEAD:…` 验证过，整文件 139 行差异），本轮没有顺手重排它；新增的 CSS 块与该文件既有风格一致（27 处同样未折行的长选择器、10 处同样单行的 `color-mix`）。

## 未闭合

全部是 jsdom 单测。没有做真实浏览器下的对话框像素/焦点复验，也没有核对原生 `Pti` 的实际视觉表现——本轮只对齐了文案、出口数量和写入顺序。官方 `canContinue === false` 那条分支（没有可用的受限模式）在我们这里由于 fallback 是常量而不可达，组件支持它、helper 也断言了常量取值，但运行时走不到，不能宣称验过。ChatGPT 模式文案不在范围内。
