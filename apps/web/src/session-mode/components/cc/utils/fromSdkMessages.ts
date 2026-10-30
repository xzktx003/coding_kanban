import type { SdkSessionMessage } from '@session/services/apiAdapt/cc';
import type { CCMessage } from '../types/messages';

/**
 * Convert SDK SessionMessage[] (from the Rust get_session_messages call) into
 * CCMessage[] for use in the store. The SDK already handles:
 *   - parentUuid chain building (correct ordering, branch handling)
 *   - filtering out isMeta / isSidechain / teamName entries
 *
 * We only need to flatten the user message shape to match CCMessage.
 */
export function fromSdkMessages(sdkMessages: SdkSessionMessage[], sessionId: string): CCMessage[] {
  return sdkMessages.map((msg) => {
    const historyMetadata = {
      ...(msg.truncated === true ? { truncated: true } : {}),
      ...(typeof msg.historyDetail?.itemId === 'string' && msg.historyDetail.itemId.length > 0 && msg.historyDetail.itemId.length <= 512
        ? { historyDetail: { itemId: msg.historyDetail.itemId } } : {}),
      ...(Array.isArray(msg.historyImages) ? { historyImages: msg.historyImages.filter(image => image && Number.isSafeInteger(image.index) && image.index >= 0 && image.index <= 31 && ['image/png','image/jpeg','image/gif','image/webp'].includes(image.mimeType)).slice(0,32).map(image => ({ index:image.index,mimeType:image.mimeType })) } : {}),
    };
    if (msg.type === 'user') {
      const inner = msg.message as Record<string, unknown> | null | undefined;
      const content = inner?.content;
      const base: Record<string, unknown> = {
        type: 'user',
        uuid: msg.uuid,
        session_id: sessionId,
        ...historyMetadata,
      };
      if (msg.parent_tool_use_id) base.parent_tool_use_id = msg.parent_tool_use_id;
      if (typeof content === 'string') {
        base.text = content;
      } else if (Array.isArray(content)) {
        base.content = content;
      }
      return base as unknown as CCMessage;
    }

    return {
      type: 'assistant',
      uuid: msg.uuid,
      session_id: sessionId,
      message: msg.message ?? { content: [] },
      ...historyMetadata,
      ...(msg.parent_tool_use_id ? { parent_tool_use_id: msg.parent_tool_use_id } : {}),
    } as unknown as CCMessage;
  });
}
