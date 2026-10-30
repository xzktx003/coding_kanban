# 会话冷进入的 shared 依赖边界

## 已定位的阻塞

三页、30 个关注会话的正式样本在 `https://10.30.0.24:44723` 记录导航 p95 为 2076–2082ms、正确 composer 为 2449–2476ms，未通过两秒门槛。实际请求诊断显示，导航与输入需要的少量 shared helper 均从包根入口导入，浏览器必须请求并链接根入口的全部再导出：22 个脚本、65,591 字节，其中包括未打开的云端、Slack/GitHub/网页预览及图片能力。子模块请求于约 908ms 发起、1385ms 才结束。这是当前源码的依赖事实，不能把全部请求时长直接换算为修复收益。

独立浏览器反例持有实际 `packages/shared/dist/codex-slack-preview.js`，API 全部使用隔离 fixture。桌面及手机尺寸的会话导航均在 5 秒后仍未挂载，两个用例先红。界面不能因没有使用的预览模块而无法加载。

同次诊断中 composer 在 2182ms 可用，后台第一条正文读取在 4466ms 才发起。此前只有两次本地配置 JSON 解析，共约 0.2ms、没有 TextDecoder；不能把这次冷进入阻塞归因于后台正文预热解码。已批准的关注会话预热及可见/聚焦优先规则保持。

## 实现

TypeScript AST 根据真实运行值及声明归属识别到冷进入的 19 个 Web 文件，只使用八个既有模块：`session-tabs`、`session-projects`、`session-followups`、`session-subagents`、`composer-context`、`codex-chat-projection`、`codex-mcp-auth`、`codex-mcp-version`。它们现在使用包明确声明的同名子路径；没有依赖未声明的文件路径，也没有批量改写终端或尚未打开的功能。

每个子路径的 `types`、`default` 直接指向该模块原有的 `dist/*.d.ts`、`dist/*.js`。根入口、Node API 和模块实现保持；纯类型导入无需创建新运行依赖。模块只有协议函数、常量及既有 Set/WeakMap，没有全局监听器、计时器或请求初始化。根入口与子路径引用同一物理模块；八个身份回归逐个比较所有导出值的严格相等，保留函数、常量及聊天投影弱缓存的身份。

没有新增依赖或改锁文件，没有改开发优化器、HMR、服务启动和 shared 构建/更新流程。未关闭能力，也不通过延迟正确输入目标或假外壳完成两秒验收。

## 验证

- `session-shared-entry-dependency.spec.ts`：桌面 1440px、手机 393px，未打开的 shared 预览保持封锁时，必须显示可用导航、精确 `ux-0` 输入，并真实填写草稿；不发送任务。
- `packages/shared/src/package-exports.test.ts`：八个不存在的子路径先红，再验证根 API 与子路径的每个运行导出保持同一引用。
- shared 构建通过，shared 全套 36 项、Web 相关 24 文件 215 项通过，Web/server/runtime 类型检查均通过。

旧 44723 的补充反例附件确认两种尺寸均实际封锁一个 Slack leaf、页面错误为空、输入未挂载且任务写入为零。包含导出身份补充后的最终 shared/hook 浏览器组合在 **HTTPS LAN `https://10.30.0.24:45851`** 通过 **4/4，9.9 秒**；新冻结同时保留 2885 个 Web 文件及 89 个 shared 包文件。日志为 `shared-entry-evidenced-red.log`、`shared-hook-entry-final.log`，测试总用时不是页面两秒测量。

该候选的一次三页计时诊断仍为红灯：正确输入约 2233/2239/2246ms，没有证明比旧诊断的约 2182ms 更快。叶模块仍被依赖图逐层发现，约 628–1494ms；减少 20 个导航前脚本请求不能直接保证加载时间缩短。功能依赖反例已经关闭，严格两秒目标继续开放，不以此专项结果宣布完成或放宽门槛。

随后拟议的「主动提前请求八个纯 helper」只进入测试红阶段，**没有修改 initial entry 或 loader 产品代码，也没有宣称修复**。本机安装的 Playwright `lib/server/chromium/crNetworkManager.js` 显示：即使只注册 API 路由，协议也启用 `Fetch.enable` 的 `urlPattern: "*"`，并同时设置 `Network.setCacheDisabled: true`；未匹配 API 的脚本同样要经过路由处理。应先用原生 HTTP fixture、正常浏览器缓存及真实 HMR/SSE 对照测量，再决定是否继续加预取。原两秒红灯保留原始测量边界。

两个拟议 helper 预取断言、独立浏览器候选及红灯输出完整归档到忽略目录 `withdrawn-eight-pure-preload/`，附文件指纹和撤回原因；公共测试保留并通过既有四项模式、计划窗口及闲时预载隔离断言。shared 子路径及独立 hook 导入的功能修复保持，后续 HTTP 对照不得关闭 Network 元数据、放宽门槛或变更 30 关注／四窗格／三页负载。

日志位于忽略目录 `.dev-runtime/session-management-read-20261030/rss-diagnosis/shared-{entry,exports,leaf}-*`。旧 44723 冻结未包含 shared 的独立指纹；已在改包/构建前保存旧 shared 实物。后续前端冻结复制并记录 shared 包元数据和 dist 文件，按精确声明子路径映射同一个副本，避免借助 node_modules 链接读到后续构建。两秒多页的 p95、长测和整体交互仍须以完整新冻结单独验收，不用专项通过替代。
