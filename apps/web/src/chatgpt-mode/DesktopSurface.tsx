import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { installDesktopSurfaceHost, type DesktopSurfaceHostOwner } from '@agent-orchestrator/chatgpt-desktop-host/surface-host-bridge';
import { desktopSurfaceUrl } from './desktop-status';
import { captureDesktopReconnectRequest, installDesktopReadinessObserver, installDesktopReconnectObserver, isDesktopSurfaceReconnectGesture, nextDesktopReconnectEpoch, type DesktopReconnectRequest } from './desktop-reconnect';

export default function DesktopSurface({ active, profileId, generation, reconnectError = false, onReconnect }: {
  active: boolean; profileId: string; generation: string;
  reconnectError?: boolean;
  onReconnect?: (request: DesktopReconnectRequest) => void | Promise<void>;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<{ frame: HTMLIFrameElement; owner: DesktopSurfaceHostOwner; epoch: symbol; active: boolean; pending: boolean; reconnect?: (request: DesktopReconnectRequest) => Promise<void> } | null>(null);
  const callbackRef = useRef(onReconnect); callbackRef.current = onReconnect;
  const [slow, setSlow] = useState(false), [pending, setPending] = useState(false), [attemptError, setAttemptError] = useState(false);
  const src = desktopSurfaceUrl({ state: 'ready', profileId, generation });
  const reconnectEnabled = !!onReconnect;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) { hostRef.current?.owner.close(); hostRef.current = null; return; }
    if (hostRef.current?.frame !== frame) {
      hostRef.current?.owner.close();
      hostRef.current = { frame, owner: installDesktopSurfaceHost({ window, frame, profileId, generation }), epoch: nextDesktopReconnectEpoch(), active: false, pending: false };
      setSlow(false); setPending(false); setAttemptError(false);
    }
    const record = hostRef.current;
    record.epoch = nextDesktopReconnectEpoch();
    record.active = active;
    record.owner.confirmActive(active);
    record.reconnect = async request => {
      if (record.pending || !record.active || !request.isCurrent() || !callbackRef.current) return;
      record.pending = true; setPending(true); setAttemptError(false);
      try { await callbackRef.current(request); }
      catch { if (hostRef.current === record && request.isCurrent()) setAttemptError(true); }
      finally {
        record.pending = false;
        if (hostRef.current === record && frame.isConnected) setPending(false);
      }
    };
    const detach = reconnectEnabled ? installDesktopReconnectObserver({
      frame,
      getEpoch: () => hostRef.current === record && record.active ? record.epoch : null,
      onReconnect: request => record.reconnect?.(request),
    }) : () => {};
    const stopReadiness = active && reconnectEnabled ? installDesktopReadinessObserver({
      frame, isActive: () => hostRef.current === record && record.active, onSlow: setSlow,
    }) : () => {};
    // Fast Refresh also runs effect cleanup. Keep the iframe and its native
    // connection, while synchronously withdrawing local editing capabilities.
    return () => { record.epoch = nextDesktopReconnectEpoch(); record.active = false; stopReadiness(); detach(); record.owner.confirmActive(false); };
    // onReconnect is bound to this exact profile and generation; a status-only
    // parent render must not invalidate a user gesture already being checked.
  }, [active, profileId, generation, src, reconnectEnabled]);
  const reconnect = (event: MouseEvent<HTMLButtonElement>) => {
    const record = hostRef.current, frame = frameRef.current;
    if (!record || !frame || !isDesktopSurfaceReconnectGesture({ frame, button: event.currentTarget, event, active: record.active })) return;
    const request = captureDesktopReconnectRequest({ frame, getEpoch: () => hostRef.current === record && record.active ? record.epoch : null });
    if (request) void record.reconnect?.(request);
  };
  return src ? <>
    {active && reconnectEnabled && (slow || reconnectError || attemptError) && <div className="chatgpt-surface-wait" role="status" aria-live="polite">
      <div><strong>{reconnectError || attemptError ? '连接状态暂时无法读取，原界面仍保留' : '原界面仍在加载'}</strong>
        <span>如果界面一直无响应，可以重新连接。重新加载可能丢失未发送的草稿，不会主动发送或停止任务。</span></div>
      <button type="button" className="chatgpt-reconnect" onClick={reconnect} disabled={pending}>{pending ? '正在检查…' : '重新连接'}</button>
    </div>}
    <iframe key={`${profileId}/${generation}`} ref={frameRef} className="chatgpt-desktop-surface" src={src}
      title="ChatGPT Codex 工作区" allow="clipboard-read; clipboard-write; microphone; fullscreen"
      onLoad={() => hostRef.current?.owner.checkDocument()} />
  </> : null;
}
