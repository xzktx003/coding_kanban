# 原生模型提醒门控的来源与接入边界

基准仍是未修改的官方26.51007.21434。这里只进行了精确原包源码追踪：没有调用正式账号、读取登录文件、启动原生宿主或发外网请求。原包17份带SHA和UTF-8字节范围的切片及前后源核对在 `.dev-runtime/session-model-notice-provenance-20261027/`。当前REA ledger没有保留同一分析记录，因此复用已有原字节切片解析导入/导出，没有重复整包分析；不把静态来源当真实账号运行结果。

## 已证明的生产与消费路径

原hCa/YDa通过Gf（共享chunk的D8t→Tg）取得当前SDK client并checkGate(`3727129412`)。原ChatGPT路径cWa→Gat经固定`/wham/statsig/bootstrap`取得evaluations及SDK user，原StatsigClient接收data后initializeSync；mWa启用原实时更新。请求带stable ID、版本/构建、locale、system及extension window type等targeting。该门控不是app-server config/read、model/list或experimentalFeature，缺客户端返回false也不是正式账号false的证据。

family/version策略则完全来自原包静态函数（main字节698207–699055）：family大小写归一、数值版本分段比较（缺段按0），legacy另比较唯一tier顺序luna/terra/sol；无法解析/不兼容与同版本的处理在legacy及v2分支不同。纯规则可以分别验证，但未知gate不能由套餐、模型目录或本地默认猜测。

## 现有只读对象与缺口

官方m2i通过f2i发布shared object `statsig_evaluations`，初始及values_updated均发布。原RDn先核对payload user与当前SDK user，或完整用户哈希和evaluations匹配。未Ready是对象内payload=undefined，失配是payload=null；这不同于删除整个shared object。正式payload可能使用SDK哈希，不能直接把测试中hash_used=none的键读取方式套到真实数据。

已捕获的官方provider确有`sharedObjectRepository.get`和`addSubscriber`，未来可以只读固定key并投影一个bool，无需注入webview消息、修改VSIX或新建SDK。但该repository在activation创建一次、由所有webview共用；记录和回调没有publisher/webview ID或代次，m2i卸载也不清旧值。读取成功只能证明曾有官方发布，不能证明当前目标窗口的SDK就绪或gate仍有效。

原provider的`getThreadReadStateContext('local')`有account事件竞态保护，可返回accountId/userId而不返回token；其内部会由原auth provider取得并解析token，本轮未调用。Session公开account/read及已有feedback/refresh投影仍不足以严格匹配SDK user/account/stableID/targeting。邮箱或套餐不能替代此身份关系。

## 后续实现条件

接入必须固定宿主/版本/实例，仅保留一个门控及opaque代次；未知、loading、null、账号通知和provider变更立即撤销，并释放自有订阅。必须先证明所有可发布webview具有同等且当前有效的SDK targeting，或取得精确发布者/所选SDK归属；provider级旧快照本身不足。不得读取整个repository快照、输出原payload/用户标识，或把新造SDK/bootstrap请求当作同一官方client的结果。

最低验收包括原SDK evaluator与投影的true/false/hashed数据、loading/失败、实时更新、同值账号通知、双webview不同发布、关闭/HMR残留、实例切换及Session身份不匹配。真实账号门控仍须受授权的官方运行观察，合成夹具只证明防护逻辑。原recent入口还等待原生设置ack，本机pending或IDB保存成功不等于这个ack；两项差异分别保留，不宣称已完成正式对齐。
