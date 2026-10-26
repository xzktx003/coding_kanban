# 强度状态描述与提示主题（2026-10-16）

本项继续 [模型命令与读取状态](model-commands-state-parity-20261016.md)。R22的第三批完整92项浏览器在其冻结源码上通过，前两批失败及未复现原因保持历史边界。本项只修普通Native模型菜单的状态描述，以及本项目普通提示的主题连接；最终合批21文件327单测、相关E2E类型检查及全仓构建已通过，22个不同浏览器场景分批通过，独立终审14,326项离线证据核对无未解释失败。

隔离前端为 **HTTP `http://10.30.0.24:48865/`**，绑定`0.0.0.0`。接口由本地夹具接管，真实账号设置、正式Agent及运行层不在本项操作范围。

## 状态文案依据与实现范围

当前官方`26.51007.21434-linux-x64`的普通`hCa→lCa→uca→Doa`链将可见Power caption与live状态的effort标签分开。可见caption采用P8：轻度／中／高；状态值采用`Moa→toa`：轻度／标准／深度。未知模型的状态model label也采用Custom，官方简中为“自定义”。参考预查复核67片段，其中59项来自原包、8项产品；57个原函数与实装同体，另外两项loader/import仅路径不同。候选准备另复核11个必要原片段，未执行新的原版完整GUI或账号写入。

本地此前live状态复用P8并显示未知raw ID。现仅为普通OpenAI状态派生model与effort名称，保持可见caption、闭合trigger、原始模型ID／effort、tooltip、最近使用和既有setter／owner规则。custom提供商的状态仍走原P8，独立Side面板不据此改词。无需更改role、aria-valuetext、滑条几何、Home/End、wheel或焦点流程。

新的真实组件测试通过实际`useModels.load`四读和真实settings／draft store执行。首轮7项取得4失败／3对照通过（3.45秒）；六个失败断言均为known medium／high和主／展开unknown的状态文案。目录引用、P8 caption／trigger、raw值、owner、draft revision和写入数量控制已通过。随后只按原标签上下文修复，并精确迁移旧unknown-label及TX测试的status预期；原始ID、aria、tooltip、recent和档位数量保护继续保留。修复后新7项与两份旧单测合批3文件113项通过（18.14秒），不是将重叠批次相加。后续Root合并回归见下文。

## 普通提示主题

R22截图中的深色会话仍出现白色普通提示。实际入口`App→ui/Toaster`未传主题，而Sonner 2.0.7默认`theme="light"`；真实`ThemeProvider`只更新会话根的class和color-scheme，不会改变该显式默认值。本项给自有wrapper接入已有`useThemeContext().resolvedTheme`，不新增主题配置或通知通道。

原3例新测试在旧实现实际得到2失败／1对照通过（2.66秒），失败仅为真实provider已解析dark、Sonner仍light。修复后三行连接的最小回归4文件12项通过（3.24秒），包括新3例、ThemeContext两例、主题按钮一例及原生通知service六例。测试使用真实Provider、store、Sonner和具名`codex-native` viewport，仅控制JSDOM缺失的媒体信号；没有mock resolvedTheme。验证dark→light、system媒体变化、同提示／草稿节点、原位置／关闭回调和默认／具名通道隔离。组件测试中固定提示时长只为保留断言对象，产品时长未修改，也不据此宣称真实计时已验。

## 后续验收与边界

Root最终合批21文件327项通过（39.15秒），相关三份E2E类型检查退出0。首轮327项也通过，但全仓检查真实退出2：新主题测试的7个Testing Library Role查询传了不支持的exact选项。保留原错误日志及旧封存，只删除这7个字段，字符串name继续精确匹配，13行Text查询及所有断言／步骤保留；局部12项重新通过后再执行最终327项。最终`pnpm check`退出0（Vite45.36秒），2951项输入前后无漂移。没有把首次类型失败写成产品红灯或构建完成。

已准备两条自然浏览器路径：1440主输入known medium→high，390展开输入unknown medium→high；返回后经真实更多菜单降低强度，切换真实主题按钮并关闭同一普通提示。另重跑原unknown-label的16条相关场景。独立R22终审还发现4条background／retained收据将初始counts保存为可变引用，终态使actual字段漂移为2／2／2／2，而初始断言确曾通过；完整目录日志保持正确。以原4条真实收据取得专项4红后，仅为check记录复制actual／expected，不修改比较或产品逻辑；最终浏览器清单因此增加这4条，合计22项。先保存状态描述、可见caption、raw／owner／草稿、受信输入、API和SSE清理，再判断结果。390为Chromium尺寸／触控模拟，不等于物理手机。

实际首批22项退出1，20通过／2失败（4.3分钟）：旧unknown-label16和收据复制4项通过，专项4份actual／expected初始快照也转绿。新两项的status与初始主题均正确，但默认右上通知覆盖真实主题按钮的指针入口；桌面等到通知消失，390px点击被通知截获并超时。移动失败的三项清理采集异常与已关闭SSE另存，不作产品主题红灯，也没有移动通知或强制点击。

仅将自然导航改为Escape关闭父菜单、Shift+Tab到真实主题按钮、Enter，第二批两项仍真实退出1（0通过／2失败）。该批同一通知节点与黑／白颜色均正确，原始初始geometry样本处于400ms入场动画中，y分别为负26.16／负30.17px，因未放宽的y≥0断言失败。保留全部旧日志、原始JSON、截图及两份测试源码，不以已经到达颜色断言称为整例通过。

第三批只保留原entry样本并等待该节点真实animations.finished后再采稳定几何，未改时长、时钟、位置、阈值或产品。实际退出0，两项通过（18.5秒），2951输入前后无漂移；原entry负y、400ms running及两项finished仍可见，settled transform为0，桌面y20／窄屏y16，通知与关闭按钮均在视口内。真实Power、原始model、owner／会话、两次revision、原草稿节点与文本、默认值、另一会话、四读各一次、零额外写入、受信输入、单通知主题变化与关闭、自有SSE清理全部通过。Root实际查看两宽Power及变化后通知四张图。结果是首批20项加末批2项，共22个不同场景分批通过，不是单次22项全绿；独立终审核对14,326项离线证据，无未解释失败；三批26份canonical／附件逐字节一致，101张PNG通过完整性核验，其中4张实际查看，10个自有持久SSE均完整关闭。离线检查数量不算新增测试。后两次仅改E2E采样／导航，产品与21文件327单测输入保持不变，因此沿用已通过的整合单测／构建，不为采样修正重复构建。

相关E2E类型检查再次退出0；Root首次在仓库根执行不存在的tsc命令退出254的准备错误也保留，随后使用web包实际编译器通过，不计产品失败。所有测试均为HTTP `http://10.30.0.24:48865/` 隔离API与自有真实HTTP/EventSource。新两例不能证明通知覆盖期间的指针主题操作可达，也不将键盘通过写成该遮挡已修。

本项不证明原官方toast的完整像素、独立Side Sheet、完整slider键盘／pointer／wheel语义，也不替代新一轮长时RSS测量。正式运行层激活、Goal附件接线归属和原生跨客户端CAS仍见 [Goal验收边界](goal-parity-acceptance-20261016.md)。
