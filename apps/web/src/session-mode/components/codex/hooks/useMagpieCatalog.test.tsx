import {renderHook,waitFor,act} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
const get=vi.hoisted(()=>vi.fn());
vi.mock('@session/services/apiAdapt/shared',()=>({getJsonWithOptions:get}));
import {useMagpieCatalog} from './useMagpieCatalog';
it('reads only opened new-chat catalog and discards late closed response',async()=>{
 get.mockResolvedValue({provider:'magpie',models:[{id:'houmo/h200'}]});
 const hook=renderHook(({open})=>useMagpieCatalog(open),{initialProps:{open:false}});
 expect(get).not.toHaveBeenCalled();hook.rerender({open:true});
 await waitFor(()=>expect(hook.result.current.models[0]?.id).toBe('houmo/h200'));
 let resolve!:(value:unknown)=>void;get.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 let pending!:Promise<void>;act(()=>{pending=hook.result.current.refresh()});hook.rerender({open:false});
 await act(async()=>{resolve({provider:'magpie',models:[{id:'late'}]});await pending});
 expect(hook.result.current.models.some(x=>x.id==='late')).toBe(false);
});
