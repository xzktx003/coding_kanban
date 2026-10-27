/** The read returned no usable snapshot because its runtime/account changed.
 * A followed-history consumer must keep this revision pending, not mark it done.
 */
export class HistoryReadScopeChangedError extends Error {
  constructor() {
    super("连接或账号已变化，正在重新读取当前会话历史");
    this.name = "HistoryReadScopeChangedError";
  }
}
