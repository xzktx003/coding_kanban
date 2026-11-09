import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { loadDesktopStatus, type DesktopStatus, type ProjectPersistenceState } from './desktop-status';

const REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

const labels: Record<ProjectPersistenceState, { text: string; detail: string }> = {
  active: { text: '项目快照正常', detail: '最近一次项目快照已保存；后续更改可能仍在处理中。' },
  waiting: { text: '项目保存等待中', detail: '正在等待项目快照。' },
  disabled: { text: '项目保存未启用', detail: '此工作区尚未启用项目持久化。' },
  unsupported: { text: '项目保存不支持', detail: '当前工作区不支持项目持久化。' },
  error: { text: '项目保存异常', detail: '无法确认项目快照已保存。' },
  unknown: { text: '项目保存状态未知', detail: '暂时无法确认项目持久化状态。' },
};

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

type Observation = { profileId: string; generation: string; state: ProjectPersistenceState };

export default function ProjectPersistenceIndicator({ active, status }: { active: boolean; status: DesktopStatus | null }) {
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => false);
  const [observation, setObservation] = useState<Observation | null>(null);
  const seenReady = useRef(false);
  const refreshOnReturn = useRef(false);
  const profileId = status?.state === 'ready' ? status.profileId : null;
  const generation = status?.state === 'ready' ? status.generation : null;

  useLayoutEffect(() => {
    if (!active || !visible) {
      if (seenReady.current) refreshOnReturn.current = true;
      return;
    }
    if (!profileId || !generation) {
      setObservation(null);
      return;
    }
    seenReady.current = true;
    let alive = true;
    let timer: number | undefined;
    let timeout: number | undefined;
    let request: AbortController | undefined;
    const setCurrent = (state: ProjectPersistenceState) => setObservation({ profileId, generation, state });
    const schedule = () => { if (alive) timer = window.setTimeout(poll, REFRESH_MS); };
    const poll = () => {
      if (!alive) return;
      const controller = new AbortController();
      request = controller;
      timeout = window.setTimeout(() => {
        if (!alive || request !== controller) return;
        request = undefined;
        controller.abort();
        setCurrent('unknown');
        schedule();
      }, REQUEST_TIMEOUT_MS);
      void loadDesktopStatus(controller.signal).then(next => {
        if (!alive || request !== controller || controller.signal.aborted) return;
        window.clearTimeout(timeout);
        request = undefined;
        if (next.state !== 'ready' || next.profileId !== profileId || next.generation !== generation) {
          // The existing iframe is bound to a different identity.  Do not follow
          // the new one or make an old value look current.
          setCurrent('unknown');
          schedule();
          return;
        }
        setCurrent(next.projectPersistence?.state ?? 'unknown');
        schedule();
      }).catch(() => {
        if (!alive || request !== controller || controller.signal.aborted) return;
        window.clearTimeout(timeout);
        request = undefined;
        setCurrent('unknown');
        schedule();
      });
    };
    if (refreshOnReturn.current) {
      refreshOnReturn.current = false;
      setCurrent('unknown');
      poll();
    } else schedule();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      request?.abort();
    };
  }, [active, visible, profileId, generation]);

  if (!active || !visible || status?.state !== 'ready') return null;
  const state = observation?.profileId === status.profileId && observation.generation === status.generation
    ? observation.state : status.projectPersistence?.state ?? 'unknown';
  const label = labels[state];
  return <span className={`chatgpt-project-persistence chatgpt-project-persistence--${state}`} role="status" aria-live="polite" title={label.detail}>
    <span className="chatgpt-project-persistence-dot" aria-hidden="true" />{label.text}
  </span>;
}
