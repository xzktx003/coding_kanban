import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import WebSocket from 'ws';
import { createChatGptDesktopCandidate } from './chatgpt-desktop-candidate.js';

const LOGIN='/__chatgpt-candidate-login';
const BRIDGE='/chatgpt-desktop/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000/bridge';
const headers={host:'candidate.invalid',origin:'https://candidate.invalid','x-forwarded-proto':'https','content-type':'application/json'};
async function candidate(t: import('node:test').TestContext) {
  const dir=await mkdtemp(join(tmpdir(),'chatgpt-auth-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const token=randomBytes(32).toString('hex'), tokenFile=join(dir,'token');
  await writeFile(tokenFile,token+'\n',{mode:0o600});
  const app=await createChatGptDesktopCandidate({profileFile:join(dir,'absent-profile.json'),authTokenFile:tokenFile});
  t.after(()=>app.close());
  return {app,token,tokenFile,dir};
}
function exchange(app: Awaited<ReturnType<typeof createChatGptDesktopCandidate>>, token:string) {
  return app.inject({method:'POST',url:LOGIN,headers,payload:JSON.stringify({token})});
}
function cookieFrom(value: string|string[]|undefined) {
  assert.equal(typeof value,'string');return (value as string).split(';')[0];
}
function upgrade(address: string,cookie?:string,origin=address) {
  return new Promise<number|undefined>((resolve,reject)=>{
    const ws=new WebSocket(address.replace(/^http/,'ws')+BRIDGE,{origin,...(cookie?{headers:{cookie}}:{})});
    ws.on('error',()=>{});
    ws.once('unexpected-response',(_request,response)=>{const status=response.statusCode;response.resume();resolve(status);ws.terminate();});
    ws.once('open',()=>{ws.terminate();reject(Error('unexpected native socket'));});
  });
}

test('token gate protects native HTTP and WSS before profile or origin handling',async t=>{
  const {app,token}=await candidate(t);const address=await app.listen({host:'127.0.0.1',port:0});
  for(const url of ['/api/chatgpt-desktop/status','/chatgpt-desktop/a/b/webview/index.html']) {
    const result=await app.inject({method:'GET',url});assert.equal(result.statusCode,401);assert.ok(!result.body.includes(token));
  }
  assert.equal(await upgrade(address),401);
  const login=await exchange(app,token);assert.equal(login.statusCode,303);
  assert.equal(login.headers.location,'/?mode=chatgpt&view=agent');
  assert.equal(login.headers['cache-control'],'no-store');assert.equal(login.headers['referrer-policy'],'no-referrer');
  const setCookie=login.headers['set-cookie'] as string;
  assert.match(setCookie,/^__Host-[^=]+=.+; Path=\/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict$/);
  assert.ok(!setCookie.includes(token));const cookie=cookieFrom(setCookie);
  assert.equal((await app.inject({method:'GET',url:'/api/chatgpt-desktop/status',headers:{cookie}})).statusCode,503);
  assert.equal(await upgrade(address,cookie),503);assert.equal(await upgrade(address,cookie,'https://foreign.invalid'),403);
  assert.equal((await app.inject({method:'GET',url:'/api/chatgpt-desktop/status',headers:{cookie:cookie+'; '+cookie}})).statusCode,401);
});

test('fixed login page clears fragment before exchanging a token and uses no arbitrary redirect',async t=>{
  const {app,token}=await candidate(t);const page=await app.inject({method:'GET',url:LOGIN});
  assert.equal(page.statusCode,200);assert.equal(page.headers['cache-control'],'no-store');
  assert.equal(page.headers['referrer-policy'],'no-referrer');assert.ok(!page.body.includes(token));
  const script=/<script>([\s\S]*)<\/script>/.exec(page.body)?.[1];assert.ok(script);
  assert.ok(String(page.headers['content-security-policy']).includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));
  const events:string[]=[],status={textContent:''},location={hash:`#token=${token}`,pathname:LOGIN,replace(value:string){events.push('redirect:'+value);}};
  const form={addEventListener(){ }},input={value:''},button={disabled:false};
  const nodes:Record<string,unknown>={'candidate-login-status':status,'candidate-login-form':form,'candidate-login-token':input,'candidate-login-submit':button};
  const context={location,history:{replaceState(_state:unknown,_title:string,path:string){events.push('clear:'+path);location.hash='';}},
    document:{getElementById(id:string){return nodes[id];}},fetch(url:string,opts:any){
      assert.equal(events[0],'clear:'+LOGIN);assert.equal(url,LOGIN);assert.ok(!url.includes(token));
      assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),{token});events.push('post');
      return Promise.resolve({status:303,type:'opaqueredirect'});
    }};
  vm.runInNewContext(script,context);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['clear:'+LOGIN,'post','redirect:/?mode=chatgpt&view=agent']);
  const rejected={...context,location:{...location,hash:`#token=${token}&next=/evil`},fetch(){throw Error('must not send');}};
  vm.runInNewContext(script,rejected);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(status.textContent,'登录链接无效。');
});

test('reusable login rejects noncanonical bodies, query parameters and cross-origin POSTs',async t=>{
  const {app,token}=await candidate(t),other=randomBytes(32).toString('hex');
  const query=await app.inject({method:'GET',url:`${LOGIN}?token=${token}`});
  assert.equal(query.statusCode,403);assert.ok(!query.body.includes(token));assert.equal(query.headers.location,undefined);
  for(const payload of [JSON.stringify({token:other}),JSON.stringify({token,next:'/elsewhere'}),`{"token":"${token}","token":""}`]) {
    const result=await app.inject({method:'POST',url:LOGIN,headers,payload});
    assert.equal(result.statusCode,403);assert.equal(result.headers['set-cookie'],undefined);assert.ok(!result.body.includes(token));
  }
  const oversized=await app.inject({method:'POST',url:LOGIN,headers,payload:JSON.stringify({token,extra:'x'.repeat(200)})});
  assert.equal(oversized.statusCode,413);assert.ok(!oversized.body.includes(token));
  for(const origin of [undefined,'https://foreign.invalid','https://candidate.invalid/']) {
    const requestHeaders: Record<string,string> = {...headers};
    if(origin===undefined) delete requestHeaders.origin;else requestHeaders.origin=origin;
    const result=await app.inject({method:'POST',url:LOGIN,headers:requestHeaders,payload:JSON.stringify({token})});
    assert.equal(result.statusCode,403);assert.equal(result.headers['set-cookie'],undefined);
  }
  const result=await exchange(app,token),again=await exchange(app,token);
  assert.equal(result.statusCode,303);assert.equal(again.statusCode,303);
  const first=cookieFrom(result.headers['set-cookie']),second=cookieFrom(again.headers['set-cookie']);assert.notEqual(first,second);
  for(const cookie of [first,second])assert.equal((await app.inject({method:'GET',url:'/api/chatgpt-desktop/status',headers:{cookie}})).statusCode,503);
});

test('a session from another candidate on the same host cannot authorize this one',async t=>{
  const a=await candidate(t),b=await candidate(t),loginA=await exchange(a.app,a.token),loginB=await exchange(b.app,b.token);
  const cookieA=cookieFrom(loginA.headers['set-cookie']),cookieB=cookieFrom(loginB.headers['set-cookie']);
  assert.notEqual(cookieA.split('=')[0],cookieB.split('=')[0]);
  assert.equal((await a.app.inject({method:'GET',url:'/api/chatgpt-desktop/status',headers:{cookie:cookieB}})).statusCode,401);
  assert.equal((await b.app.inject({method:'GET',url:'/api/chatgpt-desktop/status',headers:{cookie:cookieA}})).statusCode,401);
});

test('auth token path must name a user-owned private regular file with a canonical token',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'chatgpt-auth-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const tokenFile=join(dir,'token'),link=join(dir,'link');await writeFile(tokenFile,randomBytes(32).toString('hex')+'\n',{mode:0o600});
  await chmod(tokenFile,0o644);await assert.rejects(createChatGptDesktopCandidate({profileFile:join(dir,'profile'),authTokenFile:tokenFile}));
  await chmod(tokenFile,0o600);await symlink(tokenFile,link);await assert.rejects(createChatGptDesktopCandidate({profileFile:join(dir,'profile'),authTokenFile:link}));
  await writeFile(tokenFile,Buffer.alloc(64,0xb1),{mode:0o600});await assert.rejects(createChatGptDesktopCandidate({profileFile:join(dir,'profile'),authTokenFile:tokenFile}));
  await writeFile(tokenFile,'short\n',{mode:0o600});await assert.rejects(createChatGptDesktopCandidate({profileFile:join(dir,'profile'),authTokenFile:tokenFile}));
  await assert.rejects(createChatGptDesktopCandidate({profileFile:join(dir,'profile'),authTokenFile:'relative-token'}));
});

test('sessions expire and the fixed active-session limit cannot evict another browser',async t=>{
  const {app,token}=await candidate(t),old=Object.getOwnPropertyDescriptor(performance,'now');let now=performance.now();
  Object.defineProperty(performance,'now',{value:()=>now,configurable:true,writable:true});
  try {
    const cookies=[];
    for(let i=0;i<64;i++){const result=await exchange(app,token);assert.equal(result.statusCode,303);cookies.push(cookieFrom(result.headers['set-cookie']));}
    assert.equal((await exchange(app,token)).statusCode,503);
    assert.equal((await app.inject({method:'GET',url:'/api/chatgpt-desktop/status',headers:{cookie:cookies[0]}})).statusCode,503);
    now+=8*60*60*1000;
    assert.equal((await app.inject({method:'GET',url:'/api/chatgpt-desktop/status',headers:{cookie:cookies[0]}})).statusCode,401);
    assert.equal((await exchange(app,token)).statusCode,303);
  } finally {if(old)Object.defineProperty(performance,'now',old);else delete (performance as any).now;}
});

test('isolated real Vite proxy forwards the credential without logging it',()=>{
  const script=fileURLToPath(new URL('./candidate-proxy-auth.integration.mjs',import.meta.url)),cwd=fileURLToPath(new URL('..',import.meta.url));
  const result=spawnSync(process.execPath,['--import','tsx',script],{cwd,env:{...process.env,DEBUG:'*'},encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,'isolated proxy authentication or log redaction failed');assert.equal(result.stdout,'ok\n');
});

test('fixed login page exposes a workbench access-code form',async t=>{
  const {app,token}=await candidate(t);
  const page=await app.inject({method:'GET',url:LOGIN});
  assert.match(page.body,/工作台访问口令/);
  assert.match(page.body,/<form\b/);
  assert.match(page.body,/<input\b[^>]*type="password"/);
  assert.ok(!page.body.includes(token));
  const style=/<style>([\s\S]*)<\/style>/.exec(page.body)?.[1];assert.ok(style);
  assert.ok(String(page.headers['content-security-policy']).includes("'sha256-"+createHash('sha256').update(style).digest('base64')+"'"));
  const script=/<script>([\s\S]*)<\/script>/.exec(page.body)?.[1];assert.ok(script);
  const status={textContent:''},input={value:''},button={disabled:false};
  let submit: ((event:{preventDefault:()=>void})=>void) | undefined, succeeded=false;
  const form={addEventListener(name:string,fn:typeof submit){assert.equal(name,'submit');submit=fn;}};
  const elements:Record<string,unknown>={'candidate-login-status':status,'candidate-login-form':form,'candidate-login-token':input,'candidate-login-submit':button};
  const events:string[]=[];
  const context={location:{hash:'',pathname:LOGIN,replace(path:string){events.push('redirect:'+path);}},
    history:{replaceState(_state:unknown,_title:string,path:string){events.push('clear:'+path);}},
    document:{getElementById(id:string){return elements[id];}},fetch(url:string,options:any){
      assert.equal(url,LOGIN);assert.equal(options.credentials,'same-origin');assert.deepEqual(JSON.parse(options.body),{token});
      events.push('post');return Promise.resolve(succeeded ? {status:303} : {status:403});
    }};
  vm.runInNewContext(script,context);assert.equal(events[0],'clear:'+LOGIN);assert.ok(submit);
  input.value=token;submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(input.value,'');assert.equal(button.disabled,false);assert.match(status.textContent,/验证失败/);
  succeeded=true;input.value=token;submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(events.at(-1),'redirect:/?mode=chatgpt&view=agent');
});
