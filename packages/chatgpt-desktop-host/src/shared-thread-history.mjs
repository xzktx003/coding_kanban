// Fixed native per-turn item pagination. This is read-only validation; the
// caller still checks its daemon, account, thread and view at the actual write.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const atom = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
const opaqueCursor = (value) => value === null || (typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value));
const keys = (value, allowed, required) => object(value) && Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));

export function isSharedTurnItemsParams(params) {
  if (!keys(params, ['threadId', 'turnId', 'limit', 'cursor', 'sortDirection'], ['threadId', 'turnId', 'limit']) ||
      !UUID.test(params.threadId ?? '') || !atom(params.turnId) ||
      !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 100 ||
      (params.sortDirection != null && !['asc', 'desc'].includes(params.sortDirection))) return false;
  const cursor = params.cursor;
  if (cursor === undefined || opaqueCursor(cursor)) return true;
  return keys(cursor, ['type', 'itemId'], ['type', 'itemId']) && cursor.type === 'item' && atom(cursor.itemId);
}

export function isSharedTurnItemsPage(result, params) {
  if (!isSharedTurnItemsParams(params) || !object(result) || !Array.isArray(result.data) || result.data.length > params.limit ||
      !Object.hasOwn(result, 'nextCursor') || !opaqueCursor(result.nextCursor) ||
      !Object.hasOwn(result, 'backwardsCursor') || !opaqueCursor(result.backwardsCursor) ||
      (typeof params.cursor === 'string' && result.nextCursor === params.cursor)) return false;
  return result.data.every((entry) => object(entry) && entry.turnId === params.turnId && object(entry.item) && atom(entry.item.id));
}
