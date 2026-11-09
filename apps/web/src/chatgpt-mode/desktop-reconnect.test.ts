import { afterEach, expect, it, vi } from 'vitest';
import { captureDesktopReconnectRequest, installDesktopReconnectObserver, isDesktopReconnectGesture, isDesktopSurfaceReconnectGesture, nextDesktopReconnectEpoch, type DesktopReconnectRequest } from './desktop-reconnect';

afterEach(() => document.body.replaceChildren());

it('establishes a fresh epoch for a pre-upgrade mounted surface', () => {
  const first = nextDesktopReconnectEpoch();
  expect(typeof first).toBe('symbol');
  expect(nextDesktopReconnectEpoch()).not.toBe(first);
});

function fixture() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const status = doc.createElement('div');
  status.id = 'chatgpt-host-connection-status';
  status.setAttribute('role', 'alert');
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = '重新连接';
  status.append(button);
  doc.body.append(status);
  const event = { type: 'click', isTrusted: true, target: button, currentTarget: doc };
  return { frame, doc, status, button, event };
}

it('accepts only an explicit click on the current visible surface reconnect control', () => {
  const { frame, doc, button, event } = fixture();
  expect(isDesktopReconnectGesture({ frame, document: doc, event, active: true })).toBe(true);
  expect(isDesktopReconnectGesture({ frame, document: doc, event: { ...event, isTrusted: false }, active: true })).toBe(false);
  expect(isDesktopReconnectGesture({ frame, document: doc, event, active: false })).toBe(false);
  expect(isDesktopReconnectGesture({ frame, document: doc, event: { ...event, target: doc.body }, active: true })).toBe(false);
  button.remove();
  expect(isDesktopReconnectGesture({ frame, document: doc, event, active: true })).toBe(false);
});

it('rejects foreign or disconnected documents and events that are not clicks', () => {
  const { frame, doc, event } = fixture();
  const other = document.createElement('iframe');
  document.body.append(other);
  expect(isDesktopReconnectGesture({ frame, document: other.contentDocument!, event, active: true })).toBe(false);
  expect(isDesktopReconnectGesture({ frame, document: doc, event: { ...event, type: 'keydown' }, active: true })).toBe(false);
  frame.remove();
  expect(isDesktopReconnectGesture({ frame, document: doc, event, active: true })).toBe(false);
});

it('intercepts the original reload only once and invalidates a request after mode changes', async () => {
  const { frame, doc, event } = fixture();
  const spy = vi.spyOn(doc, 'addEventListener');
  let epoch: symbol | null = Symbol('first');
  let finish!: () => void;
  let request!: DesktopReconnectRequest;
  const onReconnect = vi.fn((value: DesktopReconnectRequest) => {
    request = value;
    return new Promise<void>(resolve => { finish = resolve; });
  });
  const dispose = installDesktopReconnectObserver({ frame, getEpoch: () => epoch, onReconnect });
  const listener = spy.mock.calls.find(([type]) => type === 'click')?.[1] as EventListener;
  const click = { ...event, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  listener(click as unknown as Event);
  listener(click as unknown as Event);
  await Promise.resolve();
  expect(onReconnect).toHaveBeenCalledTimes(1);
  expect(click.preventDefault).toHaveBeenCalledTimes(2);
  expect(request.isCurrent()).toBe(true);
  epoch = null;
  expect(request.isCurrent()).toBe(false);
  epoch = Symbol('next');
  expect(request.isCurrent()).toBe(false);
  finish();
  dispose();
  expect(request.isCurrent()).toBe(false);
});

it('accepts only a trusted gesture on the current active surface control',()=>{
  const {frame}=fixture(),button=document.createElement('button');document.body.append(button);
  const click={type:'click',isTrusted:true,currentTarget:button};
  expect(isDesktopSurfaceReconnectGesture({frame,button,event:click,active:true})).toBe(true);
  expect(isDesktopSurfaceReconnectGesture({frame,button,event:{...click,isTrusted:false},active:true})).toBe(false);
  expect(isDesktopSurfaceReconnectGesture({frame,button,event:click,active:false})).toBe(false);
  expect(isDesktopSurfaceReconnectGesture({frame,button,event:{...click,currentTarget:document.body},active:true})).toBe(false);
  button.disabled=true;
  expect(isDesktopSurfaceReconnectGesture({frame,button,event:click,active:true})).toBe(false);
});

it('revokes a captured reconnect on view retirement or a later activation epoch',()=>{
  const {frame}=fixture();let epoch: symbol | null=Symbol('first');
  const request=captureDesktopReconnectRequest({frame,getEpoch:()=>epoch});
  expect(request?.isCurrent()).toBe(true);
  epoch=null;expect(request?.isCurrent()).toBe(false);
  epoch=Symbol('next');expect(request?.isCurrent()).toBe(false);
  frame.remove();expect(request?.isCurrent()).toBe(false);
});

it('invalidates a captured reconnect if the iframe source changes before the status reply',()=>{
  const {frame}=fixture();const epoch=Symbol('first');
  const request=captureDesktopReconnectRequest({frame,getEpoch:()=>epoch});
  expect(request?.isCurrent()).toBe(true);
  frame.src='/different-document';
  expect(request?.isCurrent()).toBe(false);
});

it('never reloads after retirement and uses the pinned source only once for an initial blank document',()=>{
  let active=true,source='https://example.test/original',writes=0;
  const owner={},child={location:{reload:vi.fn()}},doc={URL:'about:blank'};
  const frame={isConnected:true,ownerDocument:owner,contentWindow:child,contentDocument:doc,
    get src(){return source},set src(value:string){source=value;writes++}} as unknown as HTMLIFrameElement;
  const epoch=Symbol('first');
  const request=captureDesktopReconnectRequest({frame,getEpoch:()=>active?epoch:null})!;
  request.reload();request.reload();expect(writes).toBe(1);expect(child.location.reload).not.toHaveBeenCalled();
  const stale=captureDesktopReconnectRequest({frame,getEpoch:()=>active?epoch:null})!;
  active=false;stale.reload();expect(writes).toBe(1);
});

it('does not promote an earlier surface error click to a later activation epoch',async()=>{
  const {frame,doc,event}=fixture();const spy=vi.spyOn(doc,'addEventListener');
  const first=Symbol('first'),next=Symbol('next');let calls=0;
  const onReconnect=vi.fn(),dispose=installDesktopReconnectObserver({frame,getEpoch:()=>++calls===1?first:next,onReconnect});
  const listener=spy.mock.calls.find(([type])=>type==='click')?.[1] as EventListener;
  listener({...event,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()} as unknown as Event);
  await Promise.resolve();expect(onReconnect).not.toHaveBeenCalled();dispose();
});
