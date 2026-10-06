import { renderHook, act } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const api=vi.hoisted(()=>({ccNewSession:vi.fn(),ccSendMessage:vi.fn(async()=>{}),ccResumeSession:vi.fn(),ccGetSessionMessages:vi.fn(),gitCreateWorktree:vi.fn()}));
vi.mock('@session/services',()=>api);vi.mock('@session/services/apiAdapt/git',()=>api);
import { useCCSessionManager } from './useCCSessionManager';
import { useCCStore } from '../stores/cc';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
beforeEach(()=>{vi.clearAllMocks();useWorkspaceStore.setState({cwd:'/project'});useCCStore.setState({options:{...useCCStore.getState().options,worktreeMode:'worktree'},isLoading:false,activeSessionId:null});});
it('does not start Claude in the shared directory when the requested worktree fails',async()=>{
 api.gitCreateWorktree.mockRejectedValue(new Error('worktree failed'));const {result}=renderHook(()=>useCCSessionManager());
 await act(async()=>{await result.current.handleNewSession('hello');});expect(api.ccNewSession).not.toHaveBeenCalled();
});
it('includes image attachments with the first Claude message',async()=>{
 useCCStore.setState({options:{...useCCStore.getState().options,worktreeMode:'local'}});
 api.ccNewSession.mockImplementation(async()=>{setTimeout(()=>{for(const event of ['cc-session-listener-ready','cc-permission-listener-ready'])window.dispatchEvent(new CustomEvent(event,{detail:{sessionId:'fixture-session'}}));},25);return 'fixture-session';});
 const {result}=renderHook(()=>useCCSessionManager());await act(async()=>{await result.current.handleNewSession('describe image',['/uploads/image.png']);});
 expect(api.ccSendMessage).toHaveBeenCalledWith('fixture-session','describe image',['/uploads/image.png']);
});
