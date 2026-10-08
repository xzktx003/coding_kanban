import { beforeEach, expect, test, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
const api = vi.hoisted(() => ({ allowSleep: vi.fn().mockResolvedValue(undefined), preventSleep: vi.fn().mockResolvedValue(undefined), threadRollback: vi.fn(), threadResume: vi.fn(), turnStart: vi.fn(), respondToPermissionsApproval: vi.fn(), respondToMcpElicitation: vi.fn(), respondToCommandExecutionApproval: vi.fn() }));
vi.mock('@session/services', () => api);
vi.mock('@session/services/apiAdapt', () => api);
import { useCodexStore as store } from '@session/components/codex/stores/useCodexStore';
import { useSessionState } from '@session/components/common/SessionStatus';
import { useTurnControl } from '@session/components/codex/hooks/useTurnControl';
import { answerTarget } from '@session/features/async-questions/service';
import { codexService } from '@session/services/codexService';
import { usePermissionsStore } from '@session/components/codex/stores/usePermissionsStore';
import { useElicitationStore } from '@session/components/codex/stores/useElicitationStore';
import { useApprovalStore } from '@session/components/codex/stores/useApprovalStore';
import { useFollowedSessionStates } from '@session/hooks/useFollowedSessionStates';
import { useAgentCenterStore } from '@session/stores/useAgentCenterStore';
import { useAcpStore } from '@session/stores/useAcpStore';
const turn = (id='t',status='inProgress') => ({id,status,items:[],startedAt:id==='new'?2:1,durationMs:null});
const event = (method:string,params:any) => store.getState().addEvent('a',{method,params:{threadId:'a',...params}} as any);
beforeEach(() => {
 vi.clearAllMocks();
 store.setState({currentThreadId:'a',currentTurnId:null,events:{},threads:[],activeThreadIds:[],threadStatusMap:{},turnTimingMap:{},retryNoticeMap:{}});
 useApprovalStore.setState({pendingApprovals:[],currentApproval:null});
 usePermissionsStore.setState({pendingRequests:[]});
 useElicitationStore.setState({pendingRequests:[]});
});
test('A1 completion must stop tab spinner even without idle notification',()=>{
 store.setState({threadStatusMap:{a:{type:'active',activeFlags:[]}}});
 event('turn/started',{turn:turn()}); event('turn/completed',{turn:turn('t','completed')});
 expect(renderHook(()=>useTurnControl()).result.current.running).toBe(false);
 expect(renderHook(()=>useSessionState('codex','a')).result.current).not.toBe('running');
});
test('A2 systemError without history must display failed',()=>{
 store.setState({threadStatusMap:{a:{type:'systemError'}}});
 expect(renderHook(()=>useSessionState('codex','a')).result.current).toBe('failed');
});
test('A3 answer target must not steer old progress under systemError',()=>{
 store.setState({threadStatusMap:{a:{type:'systemError'}},turnTimingMap:{a:{turnId:'old',status:'inProgress',startedAtMs:1,durationMs:null}}});
 expect(answerTarget('a')).toBeNull();
});
test('A4 rollback after failed snapshot must not be blocked by old progress',async()=>{
 store.setState({threadStatusMap:{a:{type:'systemError'}},turnTimingMap:{a:{turnId:'old',status:'inProgress',startedAtMs:1,durationMs:null}}});
 api.threadRollback.mockResolvedValue({thread:{id:'a',turns:[],status:{type:'idle'}}});
 await expect(codexService.threadRollback('a',1)).resolves.toBeDefined();
});
test('A5 replay of an older started event must not replace a newer tracked turn',()=>{
 event('turn/started',{turn:turn('new')}); event('turn/started',{turn:turn('old')});
 expect(store.getState().turnTimingMap.a.turnId).toBe('new');
 expect((store.getState().events.a.at(-1) as any).params.turn.id).toBe('new');
});
test('A6 failed permission response must keep a retryable pending request',async()=>{
 const r:any={requestId:3,threadId:'a',turnId:'t',permissions:{}};
 usePermissionsStore.getState().addRequest(r);
 api.respondToPermissionsApproval.mockRejectedValue(new Error('offline'));
 await expect(usePermissionsStore.getState().respond(r,{kind:'deny'})).rejects.toThrow();
 expect(usePermissionsStore.getState().pendingRequests).toHaveLength(1);
});
test('A7 failed elicitation response must keep the pending request',async()=>{
 useElicitationStore.getState().addRequest({requestId:4,threadId:'a'} as any);
 api.respondToMcpElicitation.mockRejectedValue(new Error('offline'));
 await expect(useElicitationStore.getState().respond(4,'cancel')).rejects.toThrow();
 expect(useElicitationStore.getState().pendingRequests).toHaveLength(1);
});
test('A8 replayed approval must not duplicate the pending request',()=>{
 const r:any={requestId:5,threadId:'a',turnId:'t',itemId:'i',type:'commandExecution'};
 useApprovalStore.getState().addApproval(r);useApprovalStore.getState().addApproval(r);
 expect(useApprovalStore.getState().pendingApprovals).toHaveLength(1);
});
test('A9 late approval ACK must not remove a newer request reusing the id',async()=>{
 let resolve!:()=>void;api.respondToCommandExecutionApproval.mockImplementation(()=>new Promise<void>(r=>resolve=r));
 useApprovalStore.getState().addApproval({requestId:5,threadId:'a',turnId:'old',type:'commandExecution'} as any);
 const pending=useApprovalStore.getState().respondToApproval(5,true,'accept');
 useApprovalStore.setState({pendingApprovals:[{requestId:5,threadId:'b',turnId:'new',type:'commandExecution'} as any]});
 resolve();await pending;
 expect(useApprovalStore.getState().pendingApprovals).toHaveLength(1);
});
test('A10 successful start ACK after an error must restore running without waiting for SSE',async()=>{
 store.setState({threadStatusMap:{a:{type:'systemError'}},turnTimingMap:{a:{turnId:'old',status:'failed',startedAtMs:1,durationMs:1}}});
 api.turnStart.mockResolvedValue({turn:turn('new')});
 await codexService.turnStart('a','continue');
 expect(renderHook(()=>useTurnControl()).result.current).toEqual({running:true,turnId:'new'});
});
import {useServerNotificationHandler} from '@session/components/codex/hooks/useServerNotificationHandler';
import {useRequestUserInputStore} from '@session/components/codex/stores/useRequestUserInputStore';
function handler(){return renderHook(()=>useServerNotificationHandler({isCodexThreadActiveRef:{current:false},taskCompleteBeepModeRef:{current:'never'},preventSleepDuringTasksRef:{current:false}},async()=>{})).result;}
test('A12 completion must expire approvals owned by the completed turn',()=>{
 useApprovalStore.getState().addApproval({requestId:5,threadId:'a',turnId:'t',type:'commandExecution'} as any);
 const h=handler();act(()=>h.current({method:'turn/completed',params:{threadId:'a',turn:turn('t','failed')}} as any));
 expect(useApprovalStore.getState().pendingApprovals).toHaveLength(0);
});
test('A13 terminal error without completion must expire its blocking native question',()=>{
 useRequestUserInputStore.setState({pendingRequests:[],currentRequest:null,drafts:{}});
 useRequestUserInputStore.getState().addRequest({requestId:7,threadId:'a',turnId:'t',itemId:'item',questions:[]});
 event('turn/started',{turn:turn()});const h=handler();
 act(()=>h.current({method:'error',params:{threadId:'a',turnId:'t',willRetry:false,error:{message:'capacity'}}} as any));
 expect(useRequestUserInputStore.getState().pendingRequests).toHaveLength(0);
});
test('control: normal start, retryable error, completion transitions still work',()=>{
 const h=renderHook(()=>useTurnControl());
 act(()=>event('turn/started',{turn:turn()}));
 expect(h.result.current.running).toBe(true);
 act(()=>event('error',{turnId:'t',willRetry:true,error:{message:'retry'}}));expect(h.result.current.running).toBe(true);
 act(()=>event('turn/completed',{turn:turn('t','completed')}));expect(h.result.current.running).toBe(false);
});

import { resetCodexRuntimeState } from '@session/services/codexService';
import { reconcileCodexRequests, clearCodexRequests } from '@session/components/codex/hooks/serverRequests';
import { resetRpcLifecycle, useRpcDeliveryStore } from '@session/components/codex/stores/rpcLifecycle';
import { SessionApiError } from '@session/services/apiAdapt/shared';
test('restart invalidates old history requests and permits a new request for the same thread',async()=>{
 let resolve!:(v:any)=>void;
 api.threadResume.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 const old=codexService.threadResume('a');
 resetCodexRuntimeState();
 api.threadResume.mockResolvedValueOnce({thread:{id:'a',turns:[turn('new')],status:{type:'active',activeFlags:[]}}});
 await codexService.threadResume('a');
 resolve({thread:{id:'a',turns:[turn('old','failed')],status:{type:'systemError'}}});await old;
 expect(store.getState().turnTimingMap.a.turnId).toBe('new');
 expect(store.getState().threadStatusMap.a.type).toBe('active');
});
test('a historical inProgress snapshot cannot resurrect the same completed turn',async()=>{
 event('turn/started',{turn:turn()});event('turn/completed',{turn:turn('t','completed')});
 api.threadResume.mockResolvedValueOnce({thread:{id:'a',turns:[turn()],status:{type:'active',activeFlags:[]}}});
 await codexService.threadResume('a');
 expect(store.getState().turnTimingMap.a.status).toBe('completed');
 expect(renderHook(()=>useTurnControl()).result.current.running).toBe(false);
});
test('pending snapshots preserve in-flight request identity and reconcile resolution on another page',async()=>{
 resetRpcLifecycle();
 const request:any={threadId:'a',requestId:14,turnId:'t',permissions:{}};
 usePermissionsStore.getState().addRequest(request);
 let resolve!:()=>void;api.respondToPermissionsApproval.mockImplementationOnce(()=>new Promise<void>(r=>resolve=r));
 const sending=usePermissionsStore.getState().respond(request,{kind:'deny'});
 reconcileCodexRequests([{event:'codex/permissions-request',payload:structuredClone(request)}]);
 expect(usePermissionsStore.getState().pendingRequests[0]).toBe(request);
 resolve();await sending;expect(usePermissionsStore.getState().pendingRequests).toHaveLength(0);
 usePermissionsStore.getState().addRequest(request);
 reconcileCodexRequests([]);expect(usePermissionsStore.getState().pendingRequests).toHaveLength(0);
});
test('unknown delivery keeps the request and blocks duplicate sends; definite rejection permits retry',async()=>{
 resetRpcLifecycle();
 const request:any={threadId:'a',requestId:15,turnId:'t',permissions:{}};
 usePermissionsStore.getState().addRequest(request);
 api.respondToPermissionsApproval.mockRejectedValueOnce(new Error('network'));
 await expect(usePermissionsStore.getState().respond(request,{kind:'deny'})).rejects.toThrow();
 await expect(usePermissionsStore.getState().respond(request,{kind:'deny'})).rejects.toThrow('尚未确认');
 expect(api.respondToPermissionsApproval).toHaveBeenCalledTimes(1);
 clearCodexRequests();expect(Object.keys(useRpcDeliveryStore.getState().states)).toHaveLength(0);
 usePermissionsStore.getState().addRequest(request);
 api.respondToPermissionsApproval.mockRejectedValueOnce(new SessionApiError('rejected',400));
 await expect(usePermissionsStore.getState().respond(request,{kind:'deny'})).rejects.toThrow();
 api.respondToPermissionsApproval.mockResolvedValueOnce(undefined);
 await usePermissionsStore.getState().respond(request,{kind:'deny'});
 expect(usePermissionsStore.getState().pendingRequests).toHaveLength(0);
});
