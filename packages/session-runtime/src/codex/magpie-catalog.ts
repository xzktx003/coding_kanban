import type {FastifyInstance} from 'fastify';
import {join} from 'node:path';
import {codexHome} from './accounts.js';
import {getTomlStore} from '../config/toml-store.js';
import {object,type JsonObject} from '../core/json.js';

const reasoningEfforts=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
type MagpieModel={id:string;reasoningEfforts?:string[]};

/** Only the explicitly configured local Magpie gateway; no remote credentials or redirects. */
export async function readMagpieCatalog(config:JsonObject,fetcher:typeof fetch=fetch){
 const base=object(object(config.model_providers).magpie).base_url;
 if(typeof base!=='string')return {provider:'magpie',models:[]};
 const url=new URL(base);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)
  throw Error('Magpie catalog requires a configured local gateway');
 url.pathname=url.pathname.replace(/\/$/,'')+'/models';
 const response=await fetcher(url,{signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!response.ok){await response.body?.cancel();throw Error('Magpie catalog unavailable')}
 const reader=response.body?.getReader();if(!reader)throw Error('Magpie catalog unavailable');
 let bytes=0;const chunks:Uint8Array[]=[];
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1024*1024)throw Error('Magpie catalog too large');chunks.push(part.value)}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const data=object(JSON.parse(Buffer.concat(chunks).toString('utf8'))).data;
 if(!Array.isArray(data)||data.length>2048)throw Error('Invalid Magpie catalog');
 const models=new Map<string,MagpieModel>();
 for(const row of data){
  const entry=object(row),id=entry.id;
  if(typeof id!=='string'||!id||id.length>1024||/[\x00-\x1f\x7f]/.test(id))throw Error('Invalid Magpie model');
  const model:MagpieModel={id};
  if(Object.hasOwn(entry,'reasoning_levels')){
   const levels=entry.reasoning_levels;
   if(!Array.isArray(levels)||levels.length>16||levels.some(level=>typeof level!=='string'||!reasoningEfforts.has(level)))
    throw Error('Invalid Magpie reasoning levels');
   model.reasoningEfforts=[...new Set(levels)] as string[];
  }
  if(!models.has(id))models.set(id,model);
 }
 return {provider:'magpie',models:[...models.values()]};
}
export function registerLocalMagpieCatalog(app:FastifyInstance,env:NodeJS.ProcessEnv=process.env){
 app.get('/api/session/model-catalog/magpie',async(_request,reply)=>{
  reply.header('cache-control','no-store');
  try{return await readMagpieCatalog(await getTomlStore(join(codexHome(env),'config.toml')).read())}
  catch{return reply.code(503).send({error:'无法读取 Magpie 模型目录，请确认本地网关已启动。'})}
 });
}
