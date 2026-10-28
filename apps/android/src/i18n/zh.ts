export const zh = {
  appName: "Coding Kanban",
  tagline: "手机端工作台",

  // Connection
  connectionTitle: "连接服务器",
  connectionBody:
    "输入 Coding Kanban 后端的局域网地址（含端口），例如 http://10.30.0.24:3000",
  serverUrlLabel: "服务器地址",
  serverUrlPlaceholder: "http://10.30.0.24:3000",
  connect: "连接",
  connecting: "连接中…",
  connected: "已连接",
  invalidUrl: "地址格式不正确，请检查后重试",
  connectionFailed: "无法连接到服务器",
  save: "保存",
  cancel: "取消",
  server: "服务器",
  changeServer: "切换服务器",

  // Modes
  modeTerminal: "终端",
  modeSession: "会话",

  // Bottom tabs
  tabBoard: "看板",
  tabActivity: "活动",
  tabSession: "当前会话",
  tabProjects: "项目/文件",

  // Board
  attentionQueue: "ATTENTION QUEUE",
  boardTitle: "手机工作区",
  loadingSessions: "正在加载会话…",
  emptySessions: "暂无会话，请到电脑端新建或接入会话。",
  groupResponse: "需响应",
  groupResponseDesc: "等待你的回答或确认",
  groupReview: "待验收",
  groupReviewDesc: "Agent 已完成，等待查看",
  groupExecuting: "执行中",
  groupExecutingDesc: "Agent 正在处理任务",
  groupReady: "可继续",
  groupReadyDesc: "可以继续输入或检查",
  stateRunning: "执行中",
  stateIdle: "可继续",
  stateAwaitingInput: "需响应",
  stateDetached: "已分离",
  stateExited: "已退出",
  connOnline: "已连接",
  connDegraded: "连接不稳",
  connOffline: "已断开",
  noActivity: "暂无活动。",
  noSummary: "暂无摘要，进入当前会话查看详情。",
  noWorkdir: "未提供工作目录",
  unassignedProject: "未归属项目",
  gitClean: "✓ 干净",
  filesCount: "文件",
  terminalPreview: "终端预览",

  // Session view
  currentSession: "当前会话",
  noActiveSession: "没有可用会话",
  noSession: "没有可用会话",
  fullTranscript: "完整记录",
  changes: "变更",
  files: "文件",
  chooseSession: "选择终端会话",
  allSessions: "全部会话",
  loading: "正在加载…",
  loadingTerminal: "正在加载终端…",

  // Terminal / composer
  send: "发送",
  inputPlaceholder: "输入消息或命令…",
  inputPlaceholderTerminal: "输入任务或消息…",
  terminalKeys: "快捷键",
  backToTerminal: "返回终端",
  browseFiles: "浏览文件",
  workspaces: "WORKSPACES",
  projectsTitle: "项目与文件",
  openChangesPanel: "变更",
  openTranscript: "完整记录",
  sendingDisabled: "正在连接…",

  // File browser
  fileBrowserTitle: "文件",
  emptyDir: "空目录",
  up: "上一级",
  download: "下载",
  preview: "预览",
  uploading: "上传中…",

  // Settings
  settings: "设置",
  language: "语言",
  theme: "主题",
  about: "关于",
  version: "版本",
  connectionInfo: "服务器连接信息",

  // Notifications
  notifOn: "通知开",
  notifOff: "通知关",
  notifUnsupported: "通知不可用",
  notifDenied: "通知被拒",

  // Errors
  error: "出错了",
  retry: "重试",
  unknown: "未知",
};

export type TranslationKey = keyof typeof zh;
