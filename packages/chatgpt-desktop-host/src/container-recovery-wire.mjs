const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const desc = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(desc).length !== keys.length ||
      keys.some(key => !Object.hasOwn(desc[key] ?? {}, 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, desc[key].value]));
}
export function isContainerRecoveryQuery(value) {
  try {
    const q = fields(value, ['v', 'type', 'nonce']);
    return !!q && q.v === 1 && q.type === 'recoveryStatus' && typeof q.nonce === 'string' && UUID.test(q.nonce);
  } catch { return false; }
}
export function isContainerRecoveryReply(value, identity) {
  try {
    const p = fields(value, ['v', 'type', 'nonce', 'profileId', 'generation', 'views', 'provisional', 'pendingOutput', 'ready']);
    const id = fields(identity, ['nonce', 'profileId', 'generation']);
    const views = p && fields(p.views, ['live', 'pending', 'destroying']);
    return !!p && !!id && !!views && p.v === 1 && p.type === 'recoveryStatus' &&
      ['nonce', 'profileId', 'generation'].every(key => typeof id[key] === 'string' && UUID.test(id[key]) && p[key] === id[key]) &&
      Object.values(views).every(n => Number.isSafeInteger(n) && n >= 0 && n <= 16) &&
      Number.isSafeInteger(p.provisional) && p.provisional >= 0 && p.provisional <= 16 &&
      typeof p.pendingOutput === 'boolean' && typeof p.ready === 'boolean';
  } catch { return false; }
}
export function requireIdleContainerRecoveryReply(value, identity) {
  const failure = code => Object.assign(new Error('Recovery status unavailable'), { code });
  if (!isContainerRecoveryReply(value, identity) || !value.ready || value.pendingOutput)
    throw failure('CONTAINER_RECOVERY_STATUS_UNAVAILABLE');
  if (value.views.live || value.views.pending || value.views.destroying || value.provisional)
    throw failure('CONTAINER_RECOVERY_VIEWS_ACTIVE');
  return true;
}
