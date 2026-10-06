import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const streams=vi.hoisted(()=>({ options: [] as Array<{onOpen?:()=>void}> }));
vi.mock('@session/lib/eventStream',()=>({openEventStream:(options:{onOpen?:()=>void})=>{streams.options.push(options);return ()=>{};}}));
vi.mock('@session/hooks/runtime',()=>({isDesktopTauri:()=>false}));
import { useCCStore } from '@session/stores/cc';
import { useCCSessionListener } from './index';
it('signals Claude listener readiness only after the browser event stream opens',()=>{
 useCCStore.setState({activeSessionId:'test-session'});const ready=vi.fn();window.addEventListener('cc-session-listener-ready',ready);
 try{renderHook(()=>useCCSessionListener());expect(ready).not.toHaveBeenCalled();streams.options.at(-1)?.onOpen?.();expect(ready).toHaveBeenCalledOnce();}
 finally{window.removeEventListener('cc-session-listener-ready',ready);}
});
