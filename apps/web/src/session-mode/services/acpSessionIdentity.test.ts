import {expect,it} from 'vitest';
import {acpDraftSessionId} from './acpSessionIdentity';
it('isolates identical native session IDs from two processes and prefers the durable application source',()=>{
 expect(acpDraftSessionId('s1',null,'connection-A')).not.toBe(acpDraftSessionId('s1',null,'connection-B'));
 expect(acpDraftSessionId('s1','acph_source-A','connection-A')).toBe('acph_source-A');
 expect(acpDraftSessionId(null,'acph_source-A',null)).toBe('acph_source-A');
 expect(acpDraftSessionId(null,null,null)).toBeNull();
});
