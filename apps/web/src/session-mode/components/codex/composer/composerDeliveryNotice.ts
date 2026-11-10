export type ComposerDeliveryNotice = {
  owner: string;
  text: string;
  resume?: boolean;
  queue?: boolean;
};

export function composerDeliveryNoticeText(
  notice: ComposerDeliveryNotice | null,
  owner: string,
  state: { paused: string | null; error?: string; interrupted: boolean },
): string | undefined {
  if (!notice || notice.owner !== owner) return undefined;
  if (!notice.queue) return notice.text;
  if (state.error) return "消息已接收；队列状态暂不可用，请检查";
  if (state.paused) return "消息已接收，队列已暂停；请查看待发送消息";
  if (state.interrupted) return "当前轮次已中断；请查看待发送消息";
  return "消息已接收，请查看当前会话进度";
}
