# 最近轮次的助手消息操作条（2026-10-27）

已完成的最近助手消息在桌面不再依赖 hover 才能看到复制、分支入口；历史消息继续通过 hover 或键盘焦点显示。此处“最近”来自最新原生轮次身份，不能退回“最近一个有完成答案的旧轮次”。未改变复制、分支、发送、审批或历史读取协议。

## 固定原包来源

对照未修改的 `26.51007.21434`。原包源码可读副本、精确 SHA、初始反例位于 `.dev-runtime/session-message-actions-audit-20261027/`；该副本仅格式化审计，浏览器加载原始第三方资产。

- `local-conversation-thread-turn-entries-569f96a0ae3d.js`：可读副本 440 行以 `R.findLast(isLatestTurn) ?? R.at(-1)` 选择最近轮，477 行传入 `isMostRecentTurn`。不是筛选最后一个 completed turn。
- `local-conversation-turn-fedd6e6b26d3.js`：3507/3543 行接收最近轮标记，4836 行传递 `alwaysShowAssistantMessageActions`。实际 `assistantItem` 来自 `split-items-into-render-groups-a142b98982d4.js`，并非所有 final/普通助手行都常显。
- `sites-end-resource-733bd1c6da06.js`：RD → `$b` → `cx` 传递显示条件；cx 的 `alwaysShowActions` 为真时不添加 `opacity-0`。该块 SHA-256：`5b45f53d1d05d8a47058cbb7b0f0d4e131805d6036c4a878e5ce951401018a14`。
- 分组块 SHA-256：`1ca94839adc799b852a2badbce161f140d7faca6f562bb3de525dabde2c3dccd`。永久浏览器用真实导出的 `split.n` 验证：两个 final 取后者；final 后 commentary 选择 commentary；后续 incomplete final 不回退旧 final。final 后 exec 仅在 turn complete 且 exec finished 时允许回寻 final，其他三种组合不产生 assistantItem。

最初审计的旧消息参考夹具属于 `26.51002.51308`，不能代替本次新版本证据。初始“忽略较晚 commentary，取最后 final”的建议经实际分组核对已纠正，没有作为最终实现或验收依据。

## 有界身份传播与保留边界

复用 `projectWorkflowRows` 的现有事件/消息投影，临时索引仅保存最近轮 item 的 id、type、phase、completed，按首次出现顺序更新终态；晚到的旧工具完成不会移动其位置。辅助 Set 只区分真正 completed 与 failed/interrupted。函数只额外返回最近轮 ID 和唯一候选 row ID，索引不离开调用，不保存正文或工具输出。

最近轮无答案、只有工具、新 final 尚未完成、有 live buffer、未知运行身份，均不把常显退回旧答案。原生 snapshot 中较新的 `itemsView:notLoaded` 轮次仅凭 ID 即可撤下旧标记，不需要读取其 items。现有 runtime、timing 和新增加的单个原生末轮 ID selector 作为约束；selector 返回字符串，不订阅/保留整个 turns 对象。已知较旧的 timing 身份不覆盖现有更近投影；无法在有界投影确认的新身份则保守取消常显。轻量 status 未载入本身不撤下已由完整历史确定的最近目标；常显是呈现条件，不是写入授权。

跟随原包已证实的 trailing reasoning/command/dynamic-tool 规则；不认识的尾项保留原悬停行为，不新增虚构常显目标。legacy 缺 phase 的候选继续要求已完成轮次，与本地既有 legacy 报告分组边界一致。本次没有移植原包全部云端、异步投递、生成图片和子 Agent 活动分组，也不据此关闭完整 P1.3 矩阵。

`CodexThread` 只向目标行传一个布尔值，`ThreadMessage` 的 memo 比较包含该值；旧/新目标变化不会仅因该标记让其他消息重新渲染。`EventItem` 原 owner 与 turn/item 保持。隐藏 Session/二级页、inspection 不获得常显；失去窗口焦点沿原门控处理；streaming 不渲染完成操作条。手机既有无 hover 可见和 44px 点击范围保持，未修改 CSS。

## 红绿灯与验证

证据目录：`.dev-runtime/session-latest-message-actions-20261027/`。

- `unit-red.log`：新接口未实现与真实组件常显反例共 7 失败/1 通过；其中组件已完成、focused、latest 时仍 `invisible` 是原产品红灯。
- `trailing-unit-red.log`：第一版仅按最后助手身份选择的 3 个真实反例，8 项通过。保留该错误中间版本的日志；最终已修正。
- `status-red-frame.log`：同一浏览器渲染帧确认 hasTiming=false/status=notLoaded，但已有完整最近历史的操作条仍隐藏；已删除过严的 runtime.known 条件。此前两个自动重试断言通过只因后台恢复补齐状态，不计有效红绿证据。
- `unit-accepted.log`：6 文件 35 项通过，含原投影、turn work、流式 Markdown/缓冲、窗口焦点及本次身份边界。
- 永久浏览器：`tests/e2e/session-latest-message-actions.spec.ts`。1440/390 × 深浅主题；旧/新目标、hover/键盘、流式→完成、同轮尾部工具→完成、notLoaded 新轮、隐藏二级页→恢复、草稿保留及零执行请求。第五项加载固定新原包实际 cx 与 split.n；缺显式参考地址会跳过，跳过不计原包验收。
- `browser-1.log` 的 4 绿/1 红保留：当时 notLoaded 只写了页面 store，但 HTTP fixture 仍返回旧 metadata，输入源不一致；最终同时更新 HTTP 与 store，并保留同一断言。这个失败不作为产品故障结论。
- 最终整批结果及 source 前后 SHA 见 `browser-final4.log`、`source-verification.json`；前端类型检查见 `types-accepted.log`。

产品访问：HTTPS LAN `https://10.30.0.24:8484/?mode=session`。原包参考用自有 `scripts/codex-goal-reference-server.mjs --host 0.0.0.0 --port 0`，实际 HTTP LAN 地址保存在 reference-server.log；结束后清理自有进程。所有应用接口使用隔离 HTTP/WS fixture，未发送正式任务、访问登录/IPC 或重启正式 Agent。这是浏览器尺寸模拟，非实体手机或长期 RSS 验收。

最终单批：**5/5 浏览器、20.6 秒，无跳过；6 文件 35 单测通过；前端 tsc exit 0**。8 份本次输入前后 SHA 一致。全仓构建、其他消息形态和长期内存门禁由主线程统一汇总，不将本专项计为完整 P1.3 验收。
