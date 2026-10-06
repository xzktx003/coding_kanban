export function formatThreadAge(timestampSeconds: number): string {
  const nowSeconds = Date.now() / 1000;
  const deltaSeconds = Math.max(0, nowSeconds - timestampSeconds);
  if (deltaSeconds < 60) {
    return 'now';
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
