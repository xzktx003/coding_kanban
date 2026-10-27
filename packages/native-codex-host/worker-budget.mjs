import { availableParallelism } from 'node:os';

/** Limit Tokio oversubscription in each explicitly owned native process. */
export function resolveAppServerWorkerThreads(value) {
  if (value === undefined)
    return Math.max(1, Math.min(8, availableParallelism()));
  if (!/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(String(value)))
    throw new Error('app-server worker threads must be an integer between 1 and 32');
  return Number(value);
}
