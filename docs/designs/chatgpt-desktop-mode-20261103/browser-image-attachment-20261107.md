# 原版图片输入与分屏实际收发（2026-11-07）

独立 HTTPS LAN 候选 `https://10.30.0.26:8525/?mode=chatgpt&view=agent` 已从原版菜单选取 PNG，显示原版附件预览，经原版 Send 一次发送，真实 `gpt-6.1-sol` 读图回复 **85**。native 记录含同一 PNG 的 `input_image`，1119 字节/SHA 与选中文件完全一致；提示不含答案，未调用工具。完成后 composer 文档为空，附件从输入区移除，Stop/Queue 结束。

继续在此冷启动后的 V4 界面把两个已有真实会话向右拆分：右侧 B 追问得到其独有标识；切回左侧 C，追问“上一次回复中的数字”得到 85。两次提示均不含答案，实际 native 分别只增加一次 turn。最终可见两窗格、唯一激活窗格与一个公共输入框，明确显示“当前输入目标”，C 被选中且清稿。图片不被再次附带到 C 的后续文字轮。

实现把浏览器图片字节交给原 AppHost 的 `persistImageFileToTemp`，返回原版文件描述符，由原 composer 决定是否接纳附件及发送。附件选择有独立本地 scope：同一原 footer/controller/editor/目标下普通 React 提交不会撤销文件选择；实际身份、目标、模式、窗格变化或销毁仍撤销。它不授予 native 权限，原账号/实例与写前检查保持。

只支持 PNG/JPEG，最多 4 张、每张 2 MiB、总计 4 MiB；保留格式、激活、可信事件和预算检查，通用文件/目录尚不支持。测试首次使用 Playwright buffer、随后文件路径，两者均产生 `change.isTrusted=false`，在 persist 前明确拒绝；没有发送模型。独立 fixture 证明直接 CDP `DOM.setFileInputFiles` 触发真实可信 change 后，第三次文件选择和唯一模型发送成功。未将非可信事件伪装为可信，也未删除产品检查；旧失败与首因保留。

图片源码及必要测试已与队列修复整合。实际候选仍含纯数字/ROP 观察 overlay，主线不含这些观察；不可声称本轮截图是完全相同的主线部署。**8484 继续使用已交付文字版，本轮没有替换其 native、profile、网关或用户历史。** 文件沙箱、云、SSH、共享 CLI 线程与完整资源/冷启动性能仍待验收。

[真实 native、UI 与分屏结果](artifacts/image-split-live-20261107.json) · [读图完成](artifacts/image-live-20261107.png) · [分屏继续对话](artifacts/split-image-live-20261107.png)

新建独立候选时，标准 CLI 显式设置 `CHATGPT_DESKTOP_SPLIT_PANE=1`；空/未设/`0` 保持单会话v2，其他值拒绝。自定义启动 wrapper 必须调用 `createChatGptDesktopCandidate({profileFile,authTokenFile,splitPane:true})`，只给 wrapper 设置该变量不会生效。选择固定在服务端，HTTP 参数不能改变。这仅改变新建候选，不会把线上8484或native自动升级。
