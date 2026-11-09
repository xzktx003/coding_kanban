import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

export const CANDIDATE_LOGIN_PATH = '/__chatgpt-candidate-login';
const REDIRECT = '/?mode=chatgpt&view=agent';
const SESSION_LIMIT = 64, SESSION_SECONDS = 8 * 60 * 60;
const TOKEN = /^[a-f0-9]{64}$/;
const LOGIN_SCRIPT = `(()=>{
const fragment=location.hash;
history.replaceState(null,"",location.pathname);
const status=document.getElementById("candidate-login-status");
const form=document.getElementById("candidate-login-form");
const input=document.getElementById("candidate-login-token");
const button=document.getElementById("candidate-login-submit");
function login(token){
if(!/^[a-f0-9]{64}$/.test(token)){status.textContent="请输入有效的工作台访问口令。";return}
button.disabled=true;status.textContent="正在验证…";
fetch("/__chatgpt-candidate-login",{method:"POST",credentials:"same-origin",redirect:"manual",headers:{"content-type":"application/json"},body:JSON.stringify({token})}).then(response=>{
if(response.status===303||response.type==="opaqueredirect")location.replace("/?mode=chatgpt&view=agent");
else {button.disabled=false;status.textContent="验证失败，请检查工作台访问口令。";}
},()=>{button.disabled=false;status.textContent="连接失败，请重试。"});
}
form.addEventListener("submit",event=>{event.preventDefault();const token=input.value.trim();input.value="";login(token)});
const match=/^#token=([a-f0-9]{64})$/.exec(fragment);
if(match)login(match[1]);
else if(fragment)status.textContent="登录链接无效。";
})();`;
const LOGIN_STYLE = `:root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f6f7;color:#17191c}main{box-sizing:border-box;width:min(440px,calc(100% - 32px));padding:32px;border:1px solid #e2e4e7;border-radius:18px;background:#fff;box-shadow:0 14px 40px #0000000a}h1{margin:0 0 8px;font-size:24px;letter-spacing:-.02em}p{line-height:1.5;color:#60656c}label{display:block;margin:24px 0 8px;font-weight:600}input,button{box-sizing:border-box;width:100%;font:inherit;border-radius:10px;padding:12px 14px}input{border:1px solid #c9cdd2;background:transparent;color:inherit}input:focus-visible,button:focus-visible{outline:3px solid #86b8ff;outline-offset:2px}button{margin-top:16px;border:0;background:#1b1d20;color:white;font-weight:600;cursor:pointer}button:disabled{opacity:.55;cursor:wait}#candidate-login-status{min-height:1.5em;margin:12px 0 0;font-size:14px}@media(prefers-color-scheme:dark){body{background:#191a1d;color:#f4f4f4}main{background:#232529;border-color:#3a3c40}p{color:#b4b8be}input{border-color:#656971}button{background:#f1f2f3;color:#17191c}}`;
const LOGIN_CSP = "default-src 'none'; script-src 'sha256-" + createHash('sha256').update(LOGIN_SCRIPT).digest('base64') + "'; style-src 'sha256-" + createHash('sha256').update(LOGIN_STYLE).digest('base64') + "'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const LOGIN_PAGE = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工作台访问</title><style>' + LOGIN_STYLE + '</style></head><body><main><h1>工作台访问</h1><p>请输入工作台访问口令。此口令与 ChatGPT 账号密码无关。</p><form id="candidate-login-form" method="post" action="/__chatgpt-candidate-login"><label for="candidate-login-token">工作台访问口令</label><input id="candidate-login-token" type="password" autocomplete="off" maxlength="64" required><button id="candidate-login-submit" type="submit">进入工作台</button><p id="candidate-login-status" role="status" aria-live="polite"></p></form></main><script>' + LOGIN_SCRIPT + '</script></body></html>';
const fail = () => new Error('Invalid ChatGPT candidate authentication configuration');

async function loadToken(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\0-\x1f\x7f]/.test(path) || typeof process.getuid !== 'function') throw fail();
  let handle;
  try {
    if (await realpath(path) !== path) throw fail();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o7777n) !== 0o600n || before.nlink !== 1n || (before.size !== 64n && before.size !== 65n)) throw fail();
    const contents = Buffer.alloc(66);
    let total = 0;
    while (total < contents.length) {
      const {bytesRead} = await handle.read(contents,total,contents.length-total,total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat({bigint:true});
    const current = await lstat(path,{bigint:true});
    if (current.dev !== before.dev || current.ino !== before.ino || !current.isFile() ||
        BigInt(total) !== before.size || before.dev !== after.dev || before.ino !== after.ino ||
        before.mode !== after.mode || before.uid !== after.uid || before.nlink !== after.nlink ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        await realpath(path) !== path) throw fail();
    const text = contents.subarray(0,total).toString('utf8');
    if (!(TOKEN.test(text) || (text.endsWith('\n') && TOKEN.test(text.slice(0,-1))))) throw fail();
    const token = Buffer.from(text.slice(0,64),'hex');
    contents.fill(0);
    return token;
  } catch { throw fail(); }
  finally { await handle?.close().catch(()=>{}); }
}
function equalToken(value, expected) {
  const valid = typeof value === 'string' && TOKEN.test(value);
  const received = valid ? Buffer.from(value,'hex') : Buffer.alloc(32);
  const equal = timingSafeEqual(received,expected);
  received.fill(0);
  return valid && equal;
}
function cookieValue(header, name) {
  if (typeof header !== 'string' || header.length > 8192) return undefined;
  let value, count=0;
  for (const segment of header.split(';')) {
    const pos=segment.indexOf('=');
    if (pos<0 || segment.slice(0,pos).trim() !== name) continue;
    count++;
    value=segment.slice(pos+1).trim();
  }
  return count===1 ? value : undefined;
}
function sameOrigin(request) {
  const origin=request.headers.origin,host=request.headers.host;
  if(typeof origin!=='string' || typeof host!=='string') return false;
  const forwarded=request.headers['x-forwarded-proto'];
  const first=(Array.isArray(forwarded)?forwarded[0]:forwarded)?.split(',')[0]?.trim();
  const protocol=first==='https'||first==='wss' ? 'https' : first==='http'||first==='ws' ? 'http' : request.protocol;
  try { return origin===new URL(origin).origin && origin===`${protocol}://${host}`; }
  catch { return false; }
}

/** Explicit owner-selected access through the existing HTTPS workbench. */
export async function installChatGptWorkbenchAccess(app, {origin}={}) {
  let publicUrl;
  try { publicUrl = new URL(origin); } catch { throw fail(); }
  if (!app || typeof app.addHook !== 'function' || typeof app.get !== 'function' ||
      typeof origin !== 'string' || origin.length > 2048 || publicUrl.protocol !== 'https:' ||
      publicUrl.origin !== origin || publicUrl.username || publicUrl.password) throw fail();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    const forwarded = request.headers['x-forwarded-proto'];
    const protocol = forwarded === undefined ? request.protocol : forwarded;
    const site = request.headers['sec-fetch-site'];
    if (request.headers.host !== publicUrl.host || (protocol !== 'https' && protocol !== 'wss') ||
        (site !== undefined && site !== 'same-origin' && site !== 'none') ||
        (request.headers.origin !== undefined && request.headers.origin !== origin) ||
        (request.headers.upgrade !== undefined && request.headers.origin !== origin) ||
        (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin)) {
      return reply.code(403).send({error:'forbidden'});
    }
    const raw = request.raw.url;
    if (typeof raw === 'string' && raw.split('?', 1)[0] === CANDIDATE_LOGIN_PATH) {
      if (raw !== CANDIDATE_LOGIN_PATH) return reply.code(403).send({error:'forbidden'});
      if (request.method !== 'GET') return reply.code(405).send({error:'method_not_allowed'});
    }
  });
  app.get(CANDIDATE_LOGIN_PATH, {logLevel:'silent', exposeHeadRoute:false}, async (_request, reply) =>
    reply.code(303).header('location', REDIRECT).send());
}

/** Install only on the explicitly enabled private candidate, before routes. */
export async function installChatGptCandidateAuth(app, {tokenFile}={}) {
  if (!app || typeof app.addHook !== 'function' || typeof app.get !== 'function') throw fail();
  const token=await loadToken(tokenFile);
  const sessions = new Set();
  const cookieName='__Host-chatgpt-candidate-'+randomBytes(16).toString('hex');
  function expire(now) {
    for (const entry of sessions) if (entry.expiresAt <= now) {
      entry.secret.fill(0); sessions.delete(entry);
    }
  }
  function hasSession(value) {
    const valid=typeof value==='string' && TOKEN.test(value);
    const received=valid ? Buffer.from(value,'hex') : Buffer.alloc(32);
    let matched=false;
    for(const entry of sessions) {
      const equal=timingSafeEqual(received,entry.secret);
      matched=equal || matched;
    }
    received.fill(0);
    return valid && matched;
  }
  app.addHook('onRequest', async (request,reply) => {
    reply.header('cache-control','no-store');
    reply.header('referrer-policy','no-referrer');
    const raw=request.raw.url;
    const path=typeof raw==='string'?raw.split('?',1)[0]:'';
    if(path===CANDIDATE_LOGIN_PATH) {
      if(raw!==CANDIDATE_LOGIN_PATH) return reply.code(403).send({error:'forbidden'});
      if(request.method==='GET') return;
      if(request.method==='POST') {
        if(!sameOrigin(request)) return reply.code(403).send({error:'forbidden'});
        return;
      }
      return reply.code(405).send({error:'method_not_allowed'});
    }
    expire(performance.now());
    if(!hasSession(cookieValue(request.headers.cookie,cookieName)))
      return reply.code(401).send({error:'unauthorized'});
  });
  app.get(CANDIDATE_LOGIN_PATH,{logLevel:'silent',exposeHeadRoute:false},async (_request,reply) => {
    return reply.header('content-security-policy',LOGIN_CSP)
      .header('x-content-type-options','nosniff')
      .type('text/html; charset=utf-8').send(LOGIN_PAGE);
  });
  app.addHook('onClose',async()=>{ token.fill(0);for(const entry of sessions)entry.secret.fill(0);sessions.clear(); });
  app.register(async function loginRoute(scope) {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json',{parseAs:'string',bodyLimit:128},(_request,body,done)=>{
      const match=typeof body==='string' ? /^\s*\{\s*"token"\s*:\s*"([a-f0-9]{64})"\s*\}\s*$/.exec(body) : null;
      done(null,match?.[1] ?? null);
    });
    scope.post(CANDIDATE_LOGIN_PATH,{bodyLimit:128,logLevel:'silent'},async (request,reply) => {
      const matches=equalToken(request.body,token);
      if(!matches) return reply.code(403).send({error:'forbidden'});
      const now=performance.now();expire(now);
      if(sessions.size>=SESSION_LIMIT) return reply.code(503).send({error:'session_limit'});
      const session=randomBytes(32);
      sessions.add({secret:session,expiresAt:now+SESSION_SECONDS*1000});
      reply.header('set-cookie',`${cookieName}=${session.toString('hex')}; Path=/; Max-Age=${SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`);
      return reply.code(303).header('location',REDIRECT).send();
    });
  });
}
