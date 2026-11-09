import { useEffect, useState } from 'react';
import { WorkbenchModeSwitch } from '../components/WorkbenchModeSwitch';
import type { WorkbenchMode } from '../lib/workbench-mode';
import { desktopSurfaceUrl, loadDesktopStatus, type DesktopStatus } from './desktop-status';
import DesktopSurface from './DesktopSurface';
import ProjectPersistenceIndicator from './ProjectPersistenceIndicator';
import type { DesktopReconnectRequest } from './desktop-reconnect';
import './chatgpt-mode.css';

export default function ChatgptModeApp({ active, onModeChange }: { active: boolean; onModeChange: (mode: WorkbenchMode) => void }) {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(false);
  const [reconnectError, setReconnectError] = useState(false);
  const secureContext = window.isSecureContext === true;
  useEffect(() => {
    if (!active || !secureContext || status?.state === 'ready') return;
    const controller = new AbortController();
    setChecking(true);
    void loadDesktopStatus(controller.signal).then(next => {
      if (!controller.signal.aborted) setStatus(next);
    }).catch(() => {
      if (!controller.signal.aborted) setStatus({ state: 'unavailable' });
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [active, retry, secureContext]);
  const reconnect = async (request: DesktopReconnectRequest) => {
    if (!request.isCurrent()) return;
    setReconnectError(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    try {
      const next = await loadDesktopStatus(controller.signal);
      if (!request.isCurrent()) return;
      if (next.state === 'ready' && status?.state === 'ready' &&
          next.profileId === status.profileId && next.generation === status.generation) request.reload();
      else if (next.state === 'ready') setStatus(next);
      else setReconnectError(true);
    } catch {
      if (request.isCurrent()) setReconnectError(true);
    } finally { window.clearTimeout(timer); }
  };
  const surfaceUrl = secureContext && status ? desktopSurfaceUrl(status) : null;
  const heading = !secureContext ? '请使用 HTTPS 打开桌面工作区' : status?.state === 'unauthenticated' ? '需要登录工作台' : status?.state === 'unconfigured' ? '桌面工作区尚未连接' : status?.state === 'unavailable' ? '暂时无法连接桌面工作区' : '正在连接桌面工作区';
  return (
    <section className="chatgpt-mode" hidden={!active} aria-label="ChatGPT 模式">
      <header className="chatgpt-workbench-header">
        <WorkbenchModeSwitch mode="chatgpt" onChange={onModeChange} />
        <ProjectPersistenceIndicator active={active} status={status} />
        <span className="chatgpt-workbench-label">ChatGPT</span>
      </header>
      {surfaceUrl && status?.state === 'ready' ? <DesktopSurface active={active} profileId={status.profileId} generation={status.generation} reconnectError={reconnectError} onReconnect={reconnect} /> : (
        <div className="chatgpt-connection-state" role="status" aria-live="polite">
          <svg className="chatgpt-connection-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="5" y="8" width="38" height="32" rx="10" stroke="currentColor" strokeWidth="2" /><path d="m15 19 5 5-5 5m11 0h8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h1>{heading}</h1>
          <p>{!secureContext ? '当前连接无法提供编辑器所需的浏览器能力。请通过已配置的 HTTPS 地址重新打开。' : status?.state === 'unauthenticated' ? '请输入工作台访问口令后继续。' : status?.state === 'unconfigured' ? '请先配置桌面工作区连接。' : status?.state === 'unavailable' ? '连接恢复后，项目和会话将在这里显示。' : '正在读取工作区状态…'}</p>
          {secureContext && status?.state === 'unauthenticated' ? <a className="chatgpt-reconnect chatgpt-login" href="/__chatgpt-candidate-login">登录工作台</a> :
            secureContext && status && <button className="chatgpt-reconnect" onClick={() => setRetry(value => value + 1)} disabled={checking}>{checking ? '正在连接…' : '重新连接'}</button>}
        </div>
      )}
    </section>
  );
}
