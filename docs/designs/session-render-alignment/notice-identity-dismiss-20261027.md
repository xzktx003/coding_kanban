# 通知提交改号后的关闭身份

第四批只读审查发现一个可复现的API边界：页面A保留revision=1，页面B更新独立speed组后提交revision=2；A改变model时先显示notice数字id=2，事务归并后成为id=3，但notice UUID未变。提交之后才执行捕获的dismiss(2, UUID)时，入口数字检查拒绝关闭。原唯一UI消费者是同步claim，未证明实际界面触发这个延迟路径，不能将其夸成用户已观察到的故障。

现在提供唯一身份时只核对对应notice身份；没有身份的旧调用仍要求数字id相同。事务层原本就支持将同一身份映射到当前数字id，保持不变。错误UUID、旧通知身份及纯数字旧id均不能关闭新通知；不修改模型选择、发送配置、原生回执或权限。

新增真实IDB单测先复现after-commit失败，before-commit控制和旧格式/错误身份保护保持通过。修复后相关6文件69项通过。永久浏览器用实际生产controller、真实IndexedDB和第三恢复controller核对关闭持久化，以及后来的新通知不被旧身份关闭；该文件11项通过。HTTP API请求和pageerror为零，桌面页面访问使用 **HTTPS https://10.30.0.24:8484（8484）**。

证据：`.dev-runtime/session-notice-dismiss-20261027/{red.log,green.log,browser.log,browser/}`。原始两种定序的独立诊断留在 `.dev-runtime/thread-settings-notice-race-20261027/`。本轮仅修正入口身份判断，不用此项宣称完整会话UI对齐。
