import { AddToTodo, CopyButton } from '@session/components/common';
import { Card } from '@session/components/ui/card';
import { useCCStore } from '@session/stores/cc';
import { useCCSettingsStore } from '@session/stores/settings/useCCSettingsStore';
import type { CCMessage as CCMessageType, ToolResultBlock } from '../../types/messages';
import { isToolResultBlock } from '../../types/messages';
import type { PermissionDecision } from '../../types/permission';
import { CCMessageContent } from './CCMessageContent';
import { MessageTimestamp } from '../../presentation/Spinner';
import { showsMessageActions } from '../../presentation/stream';
import { PermissionRequestCard } from './PermissionRequestCard';
import { RateLimitCard } from './RateLimitCard';
import { ResultCard } from './ResultCard';
import { SystemInitCard } from './SystemInitCard';
import { UserMessage } from './UserMessage';
import { safeStringify } from './utils';
import { ProviderHistoryDetail } from '@session/components/history/ProviderHistoryDetail';
import { isHistorySourceScopeCurrent } from '@session/components/history/historySourceScope';

interface CCMessageProps {
  message: CCMessageType;
  index: number;
  inlineErrors?: Record<string, ToolResultBlock>;
  /** Every tool result for this message, keyed by tool_use_id. */
  toolResults?: Record<string, ToolResultBlock>;
  detailVisible?: boolean;
}

const isToolBlock = (b: { type: string }) => b.type === 'tool_use' || b.type === 'tool_result';

export function CCMessage(props: CCMessageProps) {
  const msg = props.message;
  const history = msg.type === 'user' || msg.type === 'assistant' ? msg : null;
  return <>
    <CCMessageBody {...props} />
    {history?.truncated && (history.historyDetail && history.session_id
      ? <ProviderHistoryDetail provider="cc" sessionId={history.session_id} itemId={history.historyDetail.itemId} images={history.historyImages} active={props.detailVisible} sourceRow={history} sourceOwner={`cc:${history.session_id}`} onConfirmSource={async (scope, signal, cursor) => {
          const { refreshClaudeHistory } = await import('@session/services/followedSessionAuxSync');
          if (signal.aborted || !isHistorySourceScopeCurrent(scope)) throw new Error('连接已变化，请重新核对消息来源。');
          await refreshClaudeHistory(history.session_id!, signal, 'interactive', cursor);
        }} />
      : <p className="py-1 text-xs text-muted-foreground">此消息仅显示预览，完整内容暂不可读取。</p>)}
  </>;
}

function CCMessageBody({
  message: msg,
  index: idx,
  inlineErrors,
  toolResults,
  detailVisible,
}: CCMessageProps) {
  const { showPermissionCards } = useCCSettingsStore();
  const { updateMessage } = useCCStore();

  const handleResolvePermission = async (requestId: string, decision: PermissionDecision) => {
    const { resolveClaudePermission } = await import('@session/services/resolveClaudePermission');
    try {
      await resolveClaudePermission(requestId, decision);
    } catch (err) {
      console.error('Failed to resolve permission:', err);
      throw err;
    }
  };

  switch (msg.type) {
    case 'assistant': {
      const assistantText = msg.message.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return (
        <div
          className="group flex items-start gap-1 claude-presentation"
          data-testid="assistant-message"
          role="article"
        >
          {showsMessageActions({
            type: 'assistant',
            hasText: !!assistantText,
            isPartial: msg.message.content.some(
              (b) => (b as { isPartial?: boolean }).isPartial === true,
            ),
            parentToolUseId: msg.parent_tool_use_id,
          }) && (
            <div
              className="invisible group-hover:visible flex flex-col gap-0.5 shrink-0 pt-0.5 claude-assistant-actions"
              data-message-actions
            >
              <CopyButton text={assistantText} className="h-4 w-4 text-muted-foreground" />
              <AddToTodo text={assistantText} className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <CCMessageContent
              msg={msg}
              index={idx}
              isToolBlock={isToolBlock}
              inlineErrors={inlineErrors}
              toolResults={toolResults}
            />
          </div>
        </div>
      );
    }

    case 'user': {
      const text = msg.text ?? msg.content?.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map(block => block.text).join('\n') ?? '';
      const images = msg.content?.flatMap(block => {
        if (block.type !== 'image') return [];
        const source = block.source;
        if (!source || typeof source !== 'object') return [];
        if (source.type === 'base64') return typeof source.data === 'string' && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(source.media_type) ? [`data:${source.media_type};base64,${source.data}`] : [];
        if (source.type !== 'url' || typeof source.url !== 'string') return [];
        try {
          const url = new URL(source.url, window.location.origin);
          return ['http:', 'https:'].includes(url.protocol) ? [url.href] : [];
        } catch { return []; }
      }) ?? [];
      if (text || images.length) {
        return <UserMessage text={text} images={images} />;
      }
      const errors = msg.content?.filter((b) => isToolResultBlock(b) && b.is_error) ?? [];
      if (errors.length === 0) return null;
      // Errors are rendered inline in the preceding assistant message's ToolUseBadges
      return null;
    }

    case 'permission_request':
      if (!showPermissionCards) return null;
      return <PermissionRequestCard msg={msg} onResolve={handleResolvePermission} active={detailVisible} />;

    case 'system':
      return msg.subtype === 'init' ? <SystemInitCard msg={msg} /> : null;

    case 'result':
      return <ResultCard msg={msg} />;

    case 'rate_limit_event':
      return <RateLimitCard msg={msg} />;

    case 'stream_event':
      return null;

    default:
      return (
        <Card className="p-3">
          <pre className="text-xs overflow-auto max-h-64">
            <code>{safeStringify(msg)}</code>
          </pre>
        </Card>
      );
  }
}
