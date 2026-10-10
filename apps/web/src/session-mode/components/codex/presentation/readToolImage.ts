import { readFile } from "@session/services/apiAdapt/filesystem";

const pending = new Map<string, Promise<string>>();
/** Join only live reads; reopening an image must be able to see an edited file. */
export function readToolImage(path: string, owner: string | null) {
  const key = JSON.stringify([owner, path]);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = readFile(path).then(
    (value) => {
      pending.delete(key);
      return value;
    },
    (error) => {
      pending.delete(key);
      throw error;
    },
  );
  pending.set(key, request);
  return request;
}
