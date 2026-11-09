import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DESKTOP_SURFACE_HOST_KEY } from '@agent-orchestrator/chatgpt-desktop-host/surface-host-bridge';
import type { DesktopSurfaceActivationLease } from '@agent-orchestrator/chatgpt-desktop-host/surface-activation';
import DesktopSurface from './DesktopSurface';

afterEach(()=>{cleanup();vi.useRealTimers();});
const profileId='43e56e8a-de3f-40fb-8cf3-7177d17d24f1',generation='b94128f4-288c-4c97-a5cb-891555dc8199';
const scope={profileId,generation,viewId:'9d79066f-f08f-4f00-a75e-e24cc65e5d00'};
function bind(frame:HTMLIFrameElement,override:Record<string,unknown>={}) {
  const host=(frame as unknown as Record<string,{bind(options:unknown):DesktopSurfaceActivationLease}>)[DESKTOP_SURFACE_HOST_KEY]!;
  try { return host.bind({window:frame.contentWindow,document:frame.contentDocument,scope,...override}); }
  catch(error) {
    if(Object.keys(override).length) throw error;
    throw new Error(JSON.stringify({documentPresent:!!frame.contentDocument,windowPresent:!!frame.contentWindow,
      connected:frame.isConnected,parentMatches:frame.contentWindow?.parent===frame.ownerDocument.defaultView,
      documentMatches:frame.contentWindow?.document===frame.contentDocument,ownerMatches:frame.ownerDocument===window.document}),{cause:error});
  }
}

it('binds only the exact native document and revokes on mode change without remounting its iframe',()=>{
  const view=render(<DesktopSurface active profileId={profileId} generation={generation}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement;
  const lease=bind(frame),first=lease.getSnapshot();
  expect(first).not.toBeNull();
  view.rerender(<DesktopSurface active={false} profileId={profileId} generation={generation}/>);
  expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);
  expect(lease.isCurrent(first)).toBe(false);
  expect(lease.getSnapshot()).toBeNull();
  view.rerender(<DesktopSurface active profileId={profileId} generation={generation}/>);
  expect(lease.getSnapshot()).not.toBeNull();
  expect(lease.getSnapshot()).not.toBe(first);
  view.unmount();expect(lease.getSnapshot()).toBeNull();
});

it('refuses another frame or an old document despite matching profile and generation',()=>{
  render(<DesktopSurface active profileId={profileId} generation={generation}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement;
  const foreign=document.createElement('iframe');document.body.append(foreign);
  try{
    expect(()=>bind(frame,{window:foreign.contentWindow,document:foreign.contentDocument})).toThrow();
    expect(()=>bind(frame,{document:{}})).toThrow();
    expect(()=>bind(frame,{scope:{...scope,generation:profileId}})).toThrow();
  }finally{foreign.remove();}
});

it('a replacement profile gets a new document and late old cleanup cannot revoke it',()=>{
  const view=render(<DesktopSurface active profileId={profileId} generation={generation}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement,first=bind(frame),oldToken=first.getSnapshot();
  const nextGeneration='abc82834-23b6-4993-aad3-de845be2e9e4';
  view.rerender(<DesktopSurface active profileId={profileId} generation={nextGeneration}/>);
  const next=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement;
  expect(next).not.toBe(frame);expect(first.isCurrent(oldToken)).toBe(false);
  const lease=bind(next,{scope:{...scope,generation:nextGeneration,viewId:nextGeneration}}),token=lease.getSnapshot();
  first.dispose();expect(lease.isCurrent(token)).toBe(true);
});

it('offers a non-obstructive explicit reconnect when the original interface remains on its loading screen',()=>{
  vi.useFakeTimers();
  const onReconnect=vi.fn();
  render(<DesktopSurface active profileId={profileId} generation={generation} onReconnect={onReconnect}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement;
  expect(screen.queryByText('原界面仍在加载')).toBeNull();
  act(()=>vi.advanceTimersByTime(20_000));
  expect(screen.getByText('原界面仍在加载')).toBeTruthy();
  expect(screen.getByRole('button',{name:'重新连接'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'重新连接'}));
  expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);
  expect(onReconnect).not.toHaveBeenCalled();
});

it('does not start a slow-screen timer while the mode is hidden',()=>{
  vi.useFakeTimers();
  const onReconnect=vi.fn(),view=render(<DesktopSurface active={false} profileId={profileId} generation={generation} onReconnect={onReconnect}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区');act(()=>vi.advanceTimersByTime(30_000));
  expect(screen.queryByText('原界面仍在加载')).toBeNull();expect(onReconnect).not.toHaveBeenCalled();
  view.rerender(<DesktopSurface active profileId={profileId} generation={generation} onReconnect={onReconnect}/>);
  act(()=>vi.advanceTimersByTime(19_999));expect(screen.queryByText('原界面仍在加载')).toBeNull();
  act(()=>vi.advanceTimersByTime(1));expect(screen.getByText('原界面仍在加载')).toBeTruthy();
  expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);
});

it('does not warn over an already visible original sign-in screen',async()=>{
  vi.useFakeTimers();
  render(<DesktopSurface active profileId={profileId} generation={generation} onReconnect={vi.fn()}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement,doc=frame.contentDocument!;
  doc.open();doc.write('<!doctype html><html><body></body></html>');doc.close();
  const heading=doc.createElement('h1');heading.textContent='Sign in to ChatGPT';
  vi.spyOn(heading,'getBoundingClientRect').mockReturnValue({x:10,y:10,width:100,height:40,top:10,left:10,right:110,bottom:50,toJSON(){return {}}});
  await act(async()=>{doc.body.append(heading);await Promise.resolve();vi.advanceTimersByTime(30_000);});
  expect(screen.queryByText('原界面仍在加载')).toBeNull();
});

it('clears the slow warning when a visible original composer appears without replacing its iframe',async()=>{
  vi.useFakeTimers();
  render(<DesktopSurface active profileId={profileId} generation={generation} onReconnect={vi.fn()}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement,doc=frame.contentDocument!;
  doc.open();doc.write('<!doctype html><html><body></body></html>');doc.close();
  act(()=>vi.advanceTimersByTime(20_000));
  expect(screen.getByText('原界面仍在加载')).toBeTruthy();
  const composer=doc.createElement('div');composer.setAttribute('data-codex-composer','');composer.setAttribute('contenteditable','true');
  vi.spyOn(composer,'getBoundingClientRect').mockReturnValue({x:10,y:10,width:100,height:40,top:10,left:10,right:110,bottom:50,toJSON(){return {}}});
  await act(async()=>{doc.body.append(composer);await Promise.resolve();});
  expect(screen.queryByText('原界面仍在加载')).toBeNull();
  expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);
});

it('does not count a hidden composer as ready and preserves the same draft when switching modes',async()=>{
  vi.useFakeTimers();
  const view=render(<DesktopSurface active profileId={profileId} generation={generation} onReconnect={vi.fn()}/>);
  const frame=screen.getByTitle('ChatGPT Codex 工作区') as HTMLIFrameElement,doc=frame.contentDocument!;
  doc.open();doc.write('<!doctype html><html><body></body></html>');doc.close();
  const parent=doc.createElement('div'),composer=doc.createElement('div');parent.hidden=true;
  composer.setAttribute('data-codex-composer','');composer.textContent='draft';parent.append(composer);doc.body.append(parent);
  vi.spyOn(composer,'getBoundingClientRect').mockReturnValue({x:10,y:10,width:100,height:40,top:10,left:10,right:110,bottom:50,toJSON(){return {}}});
  await act(async()=>{await Promise.resolve();vi.advanceTimersByTime(20_000);});
  expect(screen.getByText('原界面仍在加载')).toBeTruthy();
  view.rerender(<DesktopSurface active={false} profileId={profileId} generation={generation} onReconnect={vi.fn()}/>);
  expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);expect(composer.textContent).toBe('draft');
  view.rerender(<DesktopSurface active profileId={profileId} generation={generation} onReconnect={vi.fn()}/>);
  expect(screen.getByTitle('ChatGPT Codex 工作区')).toBe(frame);expect(composer.textContent).toBe('draft');
});
