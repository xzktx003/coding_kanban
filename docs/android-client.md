# 安卓客户端（apps/android）

> 面向局域网使用的 Coding Kanban 手机端。这是 v1（局域网优先）：**不使用 P2P / 加密 / 中继 / 账号体系**，通过直接配置后端服务器的局域网地址访问。

## 技术栈

- **React Native 0.86.3 + Expo SDK 57**（`react 19.2.4`），需要 development build（依赖原生模块 `react-native-webview`、`react-native-screens`、`react-native-safe-area-context`、`react-native-sse`），**不能在 Expo Go 中运行**。
- 复用 monorepo 的共享类型包 `@agent-orchestrator/shared`（`packages/shared`，ESM，已构建到 `dist`）。
- 状态：`zustand`；持久化：`@react-native-async-storage/async-storage`；导航：`@react-navigation/*`。

## 仓库位置

- 源码：`apps/android/src`、`apps/android/App.tsx`
- 配置：`app.json`（包名 `ai.houmo.codingkanban`，`newArchEnabled`，`expo-build-properties` 打开 `usesCleartextTraffic`）
- 原生工程由 `npx expo prebuild --platform android` 生成到 `apps/android/android/`（生成目录已 gitignore，不重复提交）。

## 功能范围

### 连接配置
- 首页输入后端局域网地址（`http://<局域网IP>:3000`，可在无协议时自动补 `http://`）。
- 地址经 `normaliseServerUrl`/`validateServerUrl` 校验后保存到本机 `AsyncStorage`；`settings` 弹层可查看并“切换服务器”。
- v1 无鉴权。

### 终端模式（4 个 Tab）
- **看板**：按需响应 / 待验收 / 执行中 / 可继续 分组展示会话卡片（右侧顶栏可切换“会话”模式）。
- **活动**：按最近活动时间倒序的会话列表。
- **当前会话**：真实终端。RN 层持有 WebSocket，注入 xterm.js（CDN）渲染；支持键盘输入、缩放（resize）、断线重连、回放（`replayBytes`）；下方 Composer 发送任务；可切换会话、查看“记录/变更”、打开文件浏览器。
- **项目 / 文件**：按 `host + 项目目录` 分组的项目列表，可打开文件浏览器（目录导航、文本/图片预览）。

### 会话模式
- 线程列表（`POST /api/codex/thread/list`）、会话聊天（`POST /api/codex/thread/turns/list?view=chat` 读取、`POST /api/codex/turn/start` 发送、`POST /api/codex/turn/interrupt` 中断）、`/api/events` SSE 事件流刷新。

### 文件
- `POST /api/fs/list`、`POST /api/fs/preview`、`POST /api/fs/operation`；图片经 `GET /api/fs/image` 预览。

## 局域网访问约定

后端开发服务需绑定 `0.0.0.0`（`apps/server` 默认 `SERVER_BIND_HOST=0.0.0.0:3000`）。在客户端连接页填入同网段可访问地址，例如 `http://10.30.0.24:3000`。

## 运行与构建

```bash
# 安装依赖（仓库根执行；store 需重定向到工作区）
pnpm install --store-dir /data01/home/huxing/vibe_codings/coding_kanban/.pnpm-store --config.confirmModulesPurge=false

cd apps/android

# 类型检查 / 单元测试
pnpm --filter @agent-orchestrator/android run typecheck
pnpm --filter @agent-orchestrator/android run test

# 生成原生工程（首次或配置变更后）
npx expo prebuild --platform android

# 构建 debug APK（需本机 JDK17 + Android SDK，见 .toolchain）
# export JAVA_HOME=$PWD/.toolchain/jdk-17.0.21+9
# export ANDROID_HOME=$PWD/.toolchain/android-sdk
./android/gradlew -p android app:assembleDebug
```

- 构建 debug（开发用，需 Metro）：`./android/gradlew -p android app:assembleDebug`
- 构建 release（**自包含、可离线启动**，内嵌 JS bundle）：`./android/gradlew -p android app:assembleRelease`
- 输出：`apps/android/android/app/build/outputs/apk/release/app-release.apk`。
- 可直接交付副本：`apps/android/dist/coding-kanban-release.apk`（约 75 MB，v2 签名，内嵌 `assets/index.android.bundle`，安装后**无需连接 Metro 即可使用**）。
- 安装到真机：`adb install -r <apk>`（需开启 USB 调试，或直接拷贝 APK 安装）。
- 本机构建需 JDK 17 + Android SDK；受限/只读 HOME 环境下建议把 `HOME`、`GRADLE_USER_HOME`、`ANDROID_USER_HOME` 与 pnpm store 重定向到工作区可写路径，并关闭 expo 遥测（见 [debug_list](debug_list.md#2026-10-28安卓客户端在受限只读-home-环境下构建失败)）。

## 验证

- `tsc --noEmit`：通过。
- Jest 单元测试（`ts-jest`，纯逻辑）：`src/core/__tests__/config.test.ts`、`src/lib/__tests__/terminalFrames.test.ts`、`src/lib/__tests__/sessionGroups.test.ts`，共 18 个用例通过。
- Metro 打包：`npx expo export --platform android` 产出 Hermes 字节码通过。
- 原生构建：`app:assembleRelease` 成功（内嵌 JS bundle，v2 签名校验通过，`aapt` 核对包名 `ai.houmo.codingkanban`、`targetSdk 36`、可启动活动 `MainActivity`）。
- **运行时说明**：当前沙箱无 `/dev/kvm`，无法在本机启动 Android 模拟器做真机级 UI 冒烟；运行时行为需在真机或带 KVM 的环境验证。

## 协议要点（客户端实现使用的后端契约）

- 终端：WebSocket `GET /api/agent-sessions/:id/terminal-stream?replayBytes=<n>`；文本帧为原始 VT 输出；含 `__agentOrchestrator:"terminal-control"` 的 JSON 帧表示 `replay` / `replay-complete` 控制事件。输入通过 `ws.send(string)`；缩放 `POST /api/agent-sessions/:id/resize`。
- 会话模式：`POST /api/codex/thread/list`、`POST /api/codex/thread/turns/list?view=chat`、`POST /api/codex/turn/start`、`POST /api/codex/turn/interrupt`、`GET /api/events`（SSE）。
- 文件：`POST /api/fs/list` / `preview` / `operation`、`GET /api/fs/image`。

## 已知边界（v1）

- 终端渲染依赖 xterm.js 的 jsDelivr CDN，**设备需联网**才能加载；后续可改为随包发布。
- P2P / 加密 / 中继 / 账号系统仍未实现（按“局域网优先”目标范围）。
- 会话模式为功能性子集（线程列表、聊天、中断、SSE 刷新），未复刻桌面端的审批弹窗、批量停止、子 Agent 面板等高级交互。
