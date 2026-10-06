import { beforeEach, expect, it, vi } from 'vitest';
const api=vi.hoisted(()=>({threadStart:vi.fn(),gitCreateWorktree:vi.fn(),threadResume:vi.fn()}));
vi.mock('./apiAdapt',()=>api);
import { codexService } from './codexService';
import { useConfigStore } from '../components/codex/stores/useConfigStore';
import { useCodexStore } from '../components/codex/stores/useCodexStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
beforeEach(()=>{vi.clearAllMocks();useWorkspaceStore.setState({cwd:'/project'});useConfigStore.setState({threadCwdMode:'worktree',model:''});});
it('does not silently run in the shared project if preparing an isolated worktree fails',async()=>{
 api.gitCreateWorktree.mockRejectedValue(new Error('worktree failed'));
 await expect(codexService.threadStart()).rejects.toThrow('worktree failed');expect(api.threadStart).not.toHaveBeenCalled();
});

it('a late resume caches its history without stealing focus from a newer selection', async () => {
 let resolve!: (value: unknown) => void;
 api.threadResume.mockImplementation(() => new Promise(r => { resolve = r; }));
 useCodexStore.setState({ currentThreadId: null, activeThreadIds: [], events: {}, threads: [] });
 const pending = codexService.setCurrentThread('older');
 useCodexStore.setState({ currentThreadId: 'newer', inputFocusTrigger: 10 });
 resolve({ thread: { id: 'older', turns: [] } });
 await pending;
 expect(useCodexStore.getState().currentThreadId).toBe('newer');
 expect(useCodexStore.getState().inputFocusTrigger).toBe(10);
 expect(useCodexStore.getState().events.older).toEqual([]);
});
it('concurrent selections coalesce a pending resume', async () => {
 let resolve!: (value: unknown) => void;
 api.threadResume.mockImplementation(() => new Promise(r => { resolve = r; }));
 useCodexStore.setState({ currentThreadId: null, activeThreadIds: [], events: {}, threads: [] });
 const first = codexService.setCurrentThread('shared');
 const second = codexService.setCurrentThread('shared');
 expect(api.threadResume).toHaveBeenCalledTimes(1);
 resolve({ thread: { id: 'shared', turns: [] } });
 await Promise.all([first, second]);
});
it('shows loading and a retryable history error, then clears it after success', async () => {
 api.threadResume.mockRejectedValueOnce(new Error('history unavailable'));
 useCodexStore.setState({ currentThreadId: 'failed', activeThreadIds: [], events: {}, threads: [] });
 await expect(codexService.threadResume('failed')).rejects.toThrow('history unavailable');
 expect(useCodexStore.getState().historyLoadingMap.failed).toBe(false);
 expect(useCodexStore.getState().historyErrorMap.failed).toBe('history unavailable');
 api.threadResume.mockResolvedValueOnce({ thread: { id: 'failed', turns: [] } });
 await codexService.threadResume('failed');
 expect(useCodexStore.getState().historyErrorMap.failed).toBeUndefined();
});
