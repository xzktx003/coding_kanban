import type { CCMessage } from "../components/cc/types/messages";

function sameValue(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    depth > 128
  )
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index], depth + 1))
    );
  if (
    ![Object.prototype, null].includes(Object.getPrototypeOf(left)) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(right))
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameValue(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          depth + 1,
        ),
    )
  );
}

/** SDK history is JSON. Compare per row without creating two full-history strings. */
export function shareClaudeHistory(
  current: CCMessage[],
  incoming: CCMessage[],
) {
  const byId = new Map(
    current.map((message) => [(message as { uuid?: string }).uuid, message]),
  );
  const shared = incoming.map((message, index) => {
    const uuid = (message as { uuid?: string }).uuid;
    const previous = uuid ? byId.get(uuid) : current[index];
    return previous && sameValue(previous, message) ? previous : message;
  });
  return current.length === shared.length &&
    shared.every((message, index) => message === current[index])
    ? current
    : shared;
}
