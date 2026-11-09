import { createHash } from 'node:crypto';
const PRIMARY='webview/assets/app-primary-75d53eef2374.js',ENTRY='webview/__host/browser-entry.mjs';
const hash=body=>createHash('sha256').update(body).digest('hex');
const keys=['id','generation','pid','startTicks','uid','controlSocketPath','macAsarPath','macAsarSha256','linuxAsarPath','linuxAsarSha256'];
const same=(a,b)=>a&&b&&keys.every(k=>a[k]===b[k]);
function installBoundedProbe(app,{profileId,generation,profileService,load,adapt,member,max}){
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;if(!uuid.test(profileId??'')||!uuid.test(generation??'')||typeof profileService?.readValidated!=='function'||typeof load!=='function'||typeof adapt!=='function')throw Error('invalid diagnostic route');
 const fixed=`/chatgpt-desktop/${profileId}/${generation}/${member}`;let busy=false;const pending=new WeakMap();
 app.addHook('onSend',async(request,reply,payload)=>{const previous=pending.get(request);if(!previous)return payload;pending.delete(request);let valid=false;try{const current=await profileService.readValidated();valid=current?.status?.state==='ready'&&same(previous,current.profile)}catch{}if(valid)return payload;reply.removeHeader('etag');reply.removeHeader('x-original-content-sha256');reply.removeHeader('content-length');reply.code(503).type('application/json; charset=utf-8');return JSON.stringify({error:'unavailable'})});
 app.addHook('onRequest',async(request,reply)=>{
  if(request.url.split('?',1)[0]!==fixed)return;
  if(request.method!=='GET'||busy)return reply.code(503).send({error:'unavailable'});
  busy=true;let loaded,sent=false,done=false;const release=()=>{if(!done){done=true;busy=false}};
  try{
   const first=await profileService.readValidated();if(first?.status?.state!=='ready'||first.profile?.id!==profileId||first.profile?.generation!==generation)throw Error();
   loaded=await load(first.profile);if(!Buffer.isBuffer(loaded?.body)||loaded.body.length>max)throw Error();const original=hash(loaded.body),out=adapt(loaded.body);
   if(!Buffer.isBuffer(out?.body)||out.body.length>max||out.originalSha256!==original||out.adaptedSha256!==hash(out.body))throw Error();
   const latest=await profileService.readValidated();if(latest?.status?.state!=='ready'||!same(first.profile,latest.profile))throw Error();
   pending.set(request,first.profile);reply.raw.once('finish',release);reply.raw.once('close',release);sent=true;
   return reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff').header('x-original-content-sha256',original).header('etag','"'+out.adaptedSha256+'"').type('application/javascript; charset=utf-8').send(out.body);
  }catch{return reply.code(503).send({error:'unavailable'})}
  finally{try{await loaded?.dispose?.()}catch{}if(!sent)release()}
 });
}
/** Fixture-only fixed response hooks; product routes and their budgets are unchanged. */
export function installPrivateAccessProbeRoute(app,{profileId,generation,profileService,openArchive,adapt}){
 if(typeof openArchive!=='function')throw Error('invalid diagnostic route');
 return installBoundedProbe(app,{profileId,generation,profileService,adapt,member:PRIMARY,max:5*1024*1024,load:async profile=>{
  const archive=await openArchive({asarPath:profile.macAsarPath,sha256:profile.macAsarSha256});let asset;
  try{asset=await archive.acquireAsset(PRIMARY);return {body:asset.body,dispose:async()=>{try{asset.release()}finally{await archive.close()}}}}catch(error){await archive.close().catch(()=>{});throw error}
 }});
}
export function installPrivateEntryProbeRoute(app,{profileId,generation,profileService,readSource,adapt}){
 if(typeof readSource!=='function')throw Error('invalid diagnostic route');
 return installBoundedProbe(app,{profileId,generation,profileService,adapt,member:ENTRY,max:128*1024,load:async()=>({body:await readSource()})});
}
