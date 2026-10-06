import { expect, it } from 'vitest';
import { useCCStore } from '../stores/cc';
import { handleCCBackgroundEvent } from './useCCBackgroundEvents';
it('records background Claude completion after switching away from its view',()=>{
 useCCStore.setState({activeSessionId:'front',sessionLoadingMap:{background:true},sessionMessagesMap:{background:[]}});
 handleCCBackgroundEvent({seq:1,event:'cc-message',payload:{type:'result',session_id:'background',is_error:true,result:'failed',subtype:'error',duration_ms:0,duration_api_ms:0,num_turns:0}});
 expect(useCCStore.getState().sessionLoadingMap.background).toBe(false);
 expect(useCCStore.getState().sessionMessagesMap.background).toHaveLength(1);
 expect(useCCStore.getState().activeSessionId).toBe('front');
});
it('retains a permission request for a Claude session after its view is switched away', () => {
 useCCStore.setState({activeSessionId:'front',sessionLoadingMap:{background:true},sessionMessagesMap:{background:[]}});
 handleCCBackgroundEvent({seq:2,event:'cc-permission-request',payload:{requestId:'approval-1',sessionId:'background',toolName:'Bash',toolInput:{command:'pwd'},alwaysAllowTarget:'session'}});
 expect(useCCStore.getState().sessionMessagesMap.background).toEqual([expect.objectContaining({type:'permission_request',requestId:'approval-1',sessionId:'background',alwaysAllowTarget:'session'})]);
 expect(useCCStore.getState().activeSessionId).toBe('front');
});
