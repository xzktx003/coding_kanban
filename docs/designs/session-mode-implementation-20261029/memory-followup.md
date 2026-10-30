# 长期内存问题独立跟踪

**本轮原标准复验通过；长期稳定性继续跟踪。**

状态：38519单次30分钟strict gate已PASS。此前“提交时M39仍运行”的记录保留为时间顺序事实；本次PASS发生在代码提交之后。

用户于2026-10-30明确决定：“先提交已验证修复，内存问题单独跟踪。”代码提交 `118748b849abbb741804242adc2ffce7ac5ff180`（917 files，本地提交、未push）发生时，38519 M39仍在运行；本次结果是提交后的独立验收，未追溯改写提交时状态。当前该次30分钟strict gate通过；较长期稳定性观察仍单独跟踪。

## 已提交修复与用户决定

代码commit `118748b849abbb741804242adc2ffce7ac5ff180`，917 files，本地提交、未push。用户决定时M39仍运行：“先提交已验证修复，内存问题单独跟踪。”这次M39原标准复验随后在提交后通过；不会回溯声称提交时M39已经通过。

## 本次38519原标准strict复验

- 冻结源：`https://10.30.0.24:38519`；Web manifest `09dcff463bfcdc528dbcd3a85a2be3db584a1eb8aac7f6a490e831bdff711214`，shared `2482eb777c1313b7d83beb1eec5e51a12f30e02520e01021368d09bdf82cd493`，configuration `0ce68d193ced11878bf6968edf16a02cc0a2e93efe0f202421c7874b937a9cad`。
- 原始driver结果：`.dev-runtime/root-native-memory-20261030/app-body-final-strict-thirty/native-http-memory/capped.json`。`completed=true`、`formalAcceptance=true`；886 cycles/1801.97秒。
- 原门槛未变：heap low-rise <64MiB、heap peak <256MiB；RSS low-rise <128MiB、RSS peak <768MiB。实测heap low-rise 6,701,472B、heap peak162,304,884B；RSS low-rise25,477,120B（24.296875MiB）、RSS peak479,969,280B。首/末窗口分别103/90个样本。
- 自然GC和原Network观察均保持：全Network callbacks，body cache上限4MiB总计/1MiB单资源；driver、HMR proxy及UI/audio/task-write/source hash断言均为本次原始配置。
- sequence共28,352项，无gap/duplicate；taskWrites为空，`errors=[]`。最终UI仍选中唯一owner `ux-1`，latest reply在视口中，composer唯一可编辑且owner正确，draft保留，approval/latest completion状态正确。AudioContext一个，active nodes自然归零，idle27.937秒。实际HMR连接成功、60 client pings、live期间未关闭。source-after Web/shared/config hash均与source-before相符。
- **proxy错误按发生阶段记录：**driver在`Browser.close()`前同步断言live `owned.proxyErrors.length===0`并通过。其后driver先写`completed=true`，再await `Browser.close()`；close期间一条owned upstream `Error: aborted`追加到与结果共用的raw数组。因此最终raw `proxyErrors`确有一条close/aborted，不能写成最终数组为0，也不能把清理阶段事件改写为测试期live proxy失败。`errors=[]`、taskWrites=[]、live proxy assertion0、正式`formalAcceptance=true`均分别保留。wrapper `run-closure.json` exitCode0、未timeout且自有进程清理无残留；closure wrapper的`formalAcceptanceClaimed=false`不覆盖raw driver中的`formalAcceptance=true`。Root独立phase-aware audit已完成：`.dev-runtime/root-native-memory-20261030/app-body-final-strict-thirty/root-independent-audit.json`，复算数值与raw记录一致并确认live断言与cleanup数组的阶段边界。清理abort归因于cleanup是从driver同步控制流顺序作出的推断；没有直接采集该callback的发生时间。

主要记录：`.dev-runtime/root-native-memory-20261030/app-body-final-strict-thirty/native-http-memory/capped.json`、`run-start.json`、`run-closure.json`、`runner.log`。首次及前源RED保持原样。

## 既有修复与证据边界

38517/C1E4原标准M39曾以RSS low-rise134.91015625MiB高于128MiB门槛结束RED；38445的两次strict RED与38444的strict PASS也分别保留在各自冻结源历史中。本次38519通过不抹除这些记录，也不证明某一个改动是RSS变化的唯一原因。

已验证修复的本地提交与用户release决定保持独立记录。38519此次strict结果发生在提交之后，因此不声称该长测在提交前已经通过。当前单次30分钟验收也不等于24小时稳定性保证，不证明任意会话规模、浏览器或运行时都无增长；本轮strict gate已通过，长期稳定性继续单独跟踪。

完整来源和场景边界见[性能记录](performance-recovery.md)与[执行矩阵](execution-matrix.md)。
