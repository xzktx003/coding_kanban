'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BASE=['v','type','profileId','generation','streamId','requestId'];
const shapes={native:{'shared-mcp-register':['config'],'shared-mcp-response':['status','headers','body']},host:{'shared-mcp-config':['config'],'shared-mcp-request':['method','headers','body'],'shared-mcp-cancel':[]}};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function data(value){if(!object(value))return null;const descriptors=Object.getOwnPropertyDescriptors(value),out={};for(const name of Reflect.ownKeys(value)){if(typeof name!=='string'||!Object.hasOwn(descriptors[name]??{},'value'))return null;Object.defineProperty(out,name,{value:descriptors[name].value,enumerable:true});}return out;}
function literalArray(value,expected){if(!Array.isArray(value)||value.length!==expected.length||Reflect.ownKeys(value).length!==expected.length+1)return false;return expected.every((item,index)=>Object.getOwnPropertyDescriptor(value,String(index))?.value===item);}
function metadata(value){const v=data(value);return!!v&&Object.keys(v).sort().join(',')==='default_tools_approval_mode,enabled,enabled_tools,omit_tools_from,startup_timeout_sec,tool_timeout_sec'&&v.enabled===true&&literalArray(v.enabled_tools,[])&&literalArray(v.omit_tools_from,['deferred'])&&v.default_tools_approval_mode==='prompt'&&v.startup_timeout_sec===10&&v.tool_timeout_sec===3600;}
function endpoint(value){
 try{const v=data(value);if(!v||Object.keys(v).length!==8||!Object.hasOwn(v,'url')||!Object.hasOwn(v,'http_headers'))return false;
  const {url,http_headers,...rest}=v;if(!metadata(rest)||typeof url!=='string')return false;const u=new URL(url);
  const headers=data(http_headers);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^[1-9]\d{0,4}$/.test(u.port)&&Number(u.port)<=65535&&u.pathname==='/mcp'&&!u.search&&!u.hash&&!u.username&&!u.password&&u.href===url&&
   !!headers&&Object.keys(headers).join(',')==='Authorization'&&/^Bearer [A-Za-z0-9_-]{43}$/.test(headers.Authorization??'');
 }catch{return false;}
}
function headers(value,side){const v=data(value),allowed=side==='request'?['content-type','accept','mcp-session-id','mcp-protocol-version']:['content-type','mcp-session-id','mcp-protocol-version','cache-control'];return!!v&&Object.keys(v).length<=allowed.length&&Object.entries(v).every(([name,text])=>allowed.includes(name)&&typeof text==='string'&&text.length<=512&&!/[\x00-\x1f\x7f]/.test(text));}
function body(value,max){return typeof value==='string'&&value.length<=Math.ceil(max/3)*4&&value.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)&&Buffer.from(value,'base64').length<=max;}
function isSharedMcpFrame(value,{side,profileId,generation}={}){
 try{const v=data(value),extra=v&&shapes[side]?.[v.type];if(!v||!extra||Object.keys(v).sort().join(',')!==BASE.concat(extra).sort().join(',')||v.v!==1||v.profileId!==profileId||v.generation!==generation||![profileId,generation,v.streamId,v.requestId].every(x=>UUID.test(x??'')))return false;
  switch(v.type){
   case'shared-mcp-register':return metadata(v.config);
   case'shared-mcp-config':return endpoint(v.config);
   case'shared-mcp-cancel':return true;
   case'shared-mcp-request':return['POST','DELETE','GET'].includes(v.method)&&headers(v.headers,'request')&&body(v.body,64*1024);
   case'shared-mcp-response':return Number.isSafeInteger(v.status)&&v.status>=100&&v.status<=599&&headers(v.headers,'response')&&body(v.body,2*1024*1024);
   default:return false;
  }
 }catch{return false;}
}
function copyMetadata(value){if(!endpoint(value))throw Error('Shared MCP endpoint unavailable');const {url,http_headers,...rest}=data(value);return Object.freeze({...rest,enabled_tools:Object.freeze([]),omit_tools_from:Object.freeze([...rest.omit_tools_from])});}
module.exports={isSharedMcpFrame,isMcpMetadata:metadata,isMcpEndpoint:endpoint,copyMcpMetadata:copyMetadata};
