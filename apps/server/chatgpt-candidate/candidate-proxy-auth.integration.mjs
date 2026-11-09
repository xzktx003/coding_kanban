import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createViteServer } from '../../web/node_modules/vite/dist/node/index.js';
import { configureChatGptCandidate } from '../../web/chatgpt-candidate-proxy.mjs';
import { createChatGptDesktopCandidate } from './chatgpt-desktop-candidate.js';

const token=randomBytes(32).toString('hex');
const dir=await mkdtemp(join(tmpdir(),'chatgpt-auth-proxy-'));
const originalWrite=process.stderr.write.bind(process.stderr);let logs='';
process.stderr.write=((chunk)=>{logs+=String(chunk);return true;});
let backend;
let vite;
let front;
let general;
let terminal;
try {
  const tokenFile=join(dir,'token');await writeFile(tokenFile,token+'\n',{mode:0o600});
  backend=await createChatGptDesktopCandidate({profileFile:join(dir,'absent-profile'),authTokenFile:tokenFile});
  const target=await backend.listen({host:'127.0.0.1',port:0});
  general=createHttpServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('general:'+req.url);});
  terminal=new WebSocketServer({server:general});
  terminal.on('connection',socket=>socket.send('terminal-backend'));
  await new Promise(resolve=>general.listen(0,'127.0.0.1',resolve));
  const generalPort=general.address().port;
  front=createHttpServer();
  const base={configFile:false,logLevel:'silent',server:{https:{},proxy:{
    '/api':{target:`http://127.0.0.1:${generalPort}`,changeOrigin:false},
    '/ws':{target:`ws://127.0.0.1:${generalPort}`,changeOrigin:false,ws:true},
  },middlewareMode:{server:front}}};
  vite=await createViteServer(configureChatGptCandidate(base,Number(new URL(target).port)));
  front.on('request',vite.middlewares);await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));
  const addr=front.address();assert.ok(addr && typeof addr==='object');
  const origin=`http://127.0.0.1:${addr.port}`,url=`${origin}/__chatgpt-candidate-login`;
  assert.equal(await (await fetch(`${origin}/api/sessions`)).text(),'general:/api/sessions');
  assert.equal(await (await fetch(`${origin}/api/chatgpt-desktop-other`)).text(),'general:/api/chatgpt-desktop-other');
  const terminalMessage=await new Promise((resolve,reject)=>{
    const socket=new WebSocket(origin.replace('http','ws')+'/ws');
    socket.once('message',data=>{resolve(data.toString());socket.close();});socket.once('error',reject);
  });
  assert.equal(terminalMessage,'terminal-backend');
  assert.equal((await fetch(`${origin}/api/chatgpt-desktop/status`)).status,401);
  const page=await fetch(`${url}#token=${token}`);assert.equal(page.status,200);
  assert.ok(!(await page.text()).includes(token));
  const exchange=()=>fetch(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token}),redirect:'manual'});
  const login=await exchange();assert.equal(login.status,303);
  assert.equal(login.headers.get('location'),'/?mode=chatgpt&view=agent');
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  assert.equal((await fetch(`${origin}/api/chatgpt-desktop/status`,{headers:{cookie}})).status,503);
  assert.equal((await exchange()).status,303);
  await backend.close();backend=undefined;
  assert.equal((await fetch(`${url}#token=${token}`,{redirect:'manual'})).status,500);
  assert.ok(!logs.includes(token),'Vite proxy/debug errors must not expose the login token');
  assert.ok(!logs.includes(cookie.slice(cookie.indexOf('=')+1)),'Vite proxy/debug errors must not expose the session');
  process.stdout.write('ok\n');
} catch { process.exitCode=1; }
finally {
  if(front)await new Promise(resolve=>front.close(()=>resolve()));
  await vite?.close();await backend?.close();
  await new Promise(resolve=>terminal?.close(()=>resolve()) ?? resolve());
  if(general)await new Promise(resolve=>general.close(()=>resolve()));
  await rm(dir,{recursive:true,force:true});process.stderr.write=originalWrite;
}
