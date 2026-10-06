import { afterEach, expect, it, vi } from 'vitest';
import { preventBrowserSleep, allowBrowserSleep } from './browser-sleep';
afterEach(async()=>{await allowBrowserSleep();vi.unstubAllGlobals();});
it('shares the screen wake lock across concurrent tasks and releases after the last task',async()=>{
 const release=vi.fn(async()=>{});const request=vi.fn(async()=>({release,addEventListener:vi.fn()}));vi.stubGlobal('navigator',{wakeLock:{request}});
 await preventBrowserSleep('a');await preventBrowserSleep('b');expect(request).toHaveBeenCalledOnce();
 await allowBrowserSleep('a');expect(release).not.toHaveBeenCalled();await allowBrowserSleep('b');expect(release).toHaveBeenCalledOnce();
});
