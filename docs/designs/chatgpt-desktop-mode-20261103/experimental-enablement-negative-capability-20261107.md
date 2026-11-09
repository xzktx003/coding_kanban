# 原版启动功能同步的负能力返回

原版启动会自动请求 `experimentalFeature/enablement/set`。共享执行宿主不支持该功能，因此只对这个已知方法返回既有 `-32601` / `SHARED_CAPABILITY_NOT_SUPPORTED`，保持同一连接可继续读取。请求不发到 daemon，不修改任何功能开关，不返回伪造成功；账号、实例、初始化、字节预算及请求 ID 防重放校验不变。

固定 Linux chunk `early-bootstrap-439-a0f25ba32c465de1.js`（SHA `c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333`）的 `sendEnablement` catch 调用 `el.Rg6(error,method)`，识别不支持后继续。原 entry `early-bootstrap.js`（SHA `466efbe496786705721ae93dd7cd2be7c08d0f760d53adf984dfde77af93fecf`）的模块41549转导45068.Rg，后者对 code/jsonRpcCode 为 -32601 返回 true。stable0.166.0 的 `ExperimentalFeatureEnablementSetParams` 为 required enablement 的 boolean map；本适配不执行该 map。

REA静态摘录证据 `ev_027ab9bc9b525f42538bc5510f0ccd9ec049e1c7c936ccf441125f1f2bcf7f9a`，未执行原应用，语义图仍有未知关系。单元及全新无登录自有 Unix WS 回归先红后绿，核对没有该方法的上游写出、收到明确错误后仍可在同连接读取元数据。它不能代替原UI或真实模型验收。
