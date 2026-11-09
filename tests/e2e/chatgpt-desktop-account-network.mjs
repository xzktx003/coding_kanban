// Exact first-party connect origins in the pinned Mac webview/index.html CSP.
// Every other external origin is classified without exposing host/path/query.
const allowed=new Map([
 ['https://ab.chatgpt.com','chatgpt-ab'],
 ['https://cdn.openai.com','openai-cdn'],
 ['https://cdn.platform.openai.com','openai-platform-cdn'],
 ['https://learn.chatgpt.com','chatgpt-learn'],
 ['wss://chatgpt.com','chatgpt-wss'],
 ['wss://ws.chatgpt.com','chatgpt-ws'],
]);
export function classifyAccountNetwork(value,gateway){
 try{const u=value instanceof URL?value:new URL(value),g=new URL(gateway);if(u.username||u.password)return {allowed:false,category:'credentials-in-url'};
  if(u.origin===g.origin||u.origin===g.origin.replace(/^https:/,'wss:'))return {allowed:true,category:'gateway'};
  if(allowed.has(u.origin))return {allowed:true,category:allowed.get(u.origin)};
  const h=u.hostname.toLowerCase();return {allowed:false,category:h==='chatgpt.com'||h.endsWith('.chatgpt.com')?'chatgpt-other':h==='openai.com'||h.endsWith('.openai.com')?'openai-other':h==='oaistatic.com'||h.endsWith('.oaistatic.com')?'openai-static':h==='statsig.com'||h.endsWith('.statsig.com')||h==='statsigapi.net'||h.endsWith('.statsigapi.net')?'statsig':h==='sentry.io'||h.endsWith('.sentry.io')?'sentry':'external-other'};
 }catch{return {allowed:false,category:'invalid'}}
}

/** Bounded diagnostics: no credentials, path, query, fragment or headers. */
export function accountRequestMetadata(value){
 try{const u=value instanceof URL?value:new URL(value);if(!['http:','https:','ws:','wss:'].includes(u.protocol)||!u.hostname||u.hostname.length>253)return {origin:null,service:'invalid'};
  const p=u.pathname,service=/(?:^|\/)backend-api(?:\/|$)/.test(p)?'backend-api':/^\/chatgpt-desktop\/[^/]+\/[^/]+\/webview(?:\/|$)/.test(p)?'original-webview':/^\/chatgpt-desktop\/[^/]+\/[^/]+\/bridge$/.test(p)?'desktop-bridge':p==='/'?'gateway-root':'other';
  return {origin:u.origin,service};
 }catch{return {origin:null,service:'invalid'}}
}
