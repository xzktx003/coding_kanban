import { constants } from 'node:fs';
import { lstat, open, readdir, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve, parse } from 'node:path';
import TOML from '@iarna/toml';
const MAX_BYTES = 1024 * 1024;
const RESERVED_ENV = new Set(['PATH','SHELL','HOME','CODEX_HOME','TMPDIR','TMP','TEMP','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH','NATIVE_CODEX_COMPANION_CONFIG','ZDOTDIR','BASH_ENV','ENV','SHELLOPTS','BASHOPTS','PROMPT_COMMAND','PS4','LD_AUDIT','DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP']);
async function noSymlinks(path) {
 if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\0\r\n]/.test(path)) throw new Error('connection profile path invalid');
 let current=parse(path).root;
 for(const part of path.slice(current.length).split('/').filter(Boolean)){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw new Error('connection profile symlink rejected');}
}
async function privateRead(file) {
 await noSymlinks(file);
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=await fd.stat();if(!stat.isFile()||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o600||stat.size>MAX_BYTES)throw new Error('connection profile must use owned private bounded files');
  const bytes=Buffer.alloc(MAX_BYTES+1);let size=0;
  while(size<bytes.length){const {bytesRead}=await fd.read(bytes,size,bytes.length-size,null);if(!bytesRead)break;size+=bytesRead;}
  if(size>MAX_BYTES)throw new Error('connection profile file too large');
  return bytes.subarray(0,size).toString('utf8');
 }finally{await fd.close();}
}
/** Explicitly reuse an authorized connection, keeping history, IPC, tools and process HOME isolated. */
export async function importConnectionProfile(options, inherited=process.env) {
 if(!options.connectionProfileHome)return {enabled:false};
 const source=options.connectionProfileHome;const target=options.codexHome;
 await noSymlinks(source);await noSymlinks(target);
 const targetStat=await lstat(target);
 if(!targetStat.isDirectory()||targetStat.uid!==process.getuid?.()||(targetStat.mode&0o777)!==0o700)throw new Error('connection destination must be private');
 if((await readdir(target)).length)throw new Error('connection destination must be fresh');
 const authText=await privateRead(join(source,'auth.json'));
 let auth;let config;
 try{auth=JSON.parse(authText);}catch{throw new Error('connection authentication invalid');}
 if(!auth||typeof auth!=='object'||Array.isArray(auth)||!(typeof auth.OPENAI_API_KEY==='string'&&auth.OPENAI_API_KEY||typeof auth.tokens?.access_token==='string'&&auth.tokens.access_token))throw new Error('connection authentication invalid');
 const authMode=auth.auth_mode??(auth.OPENAI_API_KEY?'apikey':'chatgpt');
 if(authMode!=='chatgpt'&&authMode!=='apikey')throw new Error('connection authentication mode invalid');
 let configText='';
 try{configText=await privateRead(join(source,'config.toml'));}catch(error){if(error.code!=='ENOENT')throw error;}
 try{config=TOML.parse(configText);}catch{throw new Error('connection model configuration invalid');}
 const selected={};
 for(const key of ['model','model_provider','model_reasoning_effort','service_tier','model_context_window','disable_response_storage'])if(Object.hasOwn(config,key))selected[key]=config[key];
 const environment={};
 const provider=config.model_provider;
 if(provider&&provider!=='openai'){
  const value=config.model_providers?.[provider];if(!value||typeof value!=='object')throw new Error('selected model provider unavailable');
  selected.model_providers={[provider]:value};
  const names=[...(value.env_key?[value.env_key]:[]),...Object.values(value.env_http_headers??{})];
  for(const name of names){
   if(typeof name!=='string'||! /^[A-Z][A-Z0-9_]{0,127}$/.test(name)||RESERVED_ENV.has(name))throw new Error('provider environment name invalid');
   if(typeof inherited[name]!=='string'||!inherited[name])throw new Error('provider environment unavailable');
   environment[name]=inherited[name];
  }
 }
 let serialized;
 try{serialized=TOML.stringify(selected);}catch{throw new Error('connection model configuration invalid');}
 const created=[];
 try{
  for(const [name,value] of [['auth.json',authText],['config.toml',serialized]]){
   const file=join(target,name);await writeFile(file,value,{mode:0o600,flag:'wx'});created.push(file);
  }
 }catch(error){for(const file of created)await unlink(file).catch(()=>{});throw error;}
 // Secret values remain local to the child environment and never enter status/runtime metadata.
 options.connectionEnvironment=environment;
 return {enabled:true,authMode};
}
