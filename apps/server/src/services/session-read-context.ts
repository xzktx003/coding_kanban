interface ReadContextOptions {
  context(): Promise<{ scope: string; namespace: string }>;
  call(method: string, params: Record<string, unknown>): Promise<any>;
}

const conflict = (message: string): never => {
  throw Object.assign(new Error(message), { statusCode: 409 });
};

/** Capture BEFORE the visibility dwell. The later native CAS uses this exact
 * revision; a conflict requires another actual reading entry, never a new token.
 */
export async function visibleSessionReadContext(
  options: ReadContextOptions,
  threadId: string,
  observedReplyId: string,
): Promise<{ scope: string; revision: string; replyId: string }> {
  const before = await options.context();
  const metadata = await options.call("thread/metadata", { threadId });
  if (
    metadata?.thread?.id !== threadId ||
    typeof metadata.readState?.revision !== "string"
  )
    throw Object.assign(new Error("当前会话无法确认原生已读状态"), {
      statusCode: 503,
    });
  const recent = await options.call("thread/turns/list", {
    threadId,
    limit: 1,
    sortDirection: "desc",
    itemsView: "notLoaded",
  });
  const latest = recent?.data?.[0];
  if (
    latest?.id !== observedReplyId ||
    !["completed", "failed", "interrupted"].includes(latest.status)
  )
    conflict("最新回复已变化，请查看对应回复后再标记已读");
  const after = await options.context();
  if (after.scope !== before.scope || after.namespace !== before.namespace)
    conflict("账号或运行范围已变化，请重新查看会话");
  return {
    scope: before.scope,
    revision: metadata.readState.revision,
    replyId: observedReplyId,
  };
}
