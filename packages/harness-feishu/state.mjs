import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
/** One private process owns this state; refuse a second consumer rather than racing delivery. */
export class State {
 #dir;#rows;#lock;
 constructor(dir){
  if(typeof dir!=='string'||!isAbsolute(dir))throw Error('Private absolute dataDir required');
  mkdirSync(dir,{recursive:true,mode:0o700});const stat=lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('dataDir must be owner private');
  this.#dir=dir;this.#lock=join(dir,'owner.lock');const fd=openSync(this.#lock,'wx',0o600);closeSync(fd);
  try{const p=join(dir,'state.json');let data={};try{const stat=lstatSync(p);if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>4*1024*1024)throw Error('Invalid state');data=JSON.parse(readFileSync(p,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>10000)throw Error('Invalid state');this.#rows=new Map(Object.entries(data).filter(([,v])=>v&&Number.isFinite(v.expiresAt)&&v.expiresAt>Date.now()))}catch(e){this.close();throw e}
 }
 get(key){return this.#rows.get(key)}
 put(key,value){
  const next=new Map([...this.#rows].filter(([,v])=>v.expiresAt>Date.now()));if(next.size>=10000&&!next.has(key))throw Error('Notification state capacity reached');next.set(key,value);
  const temp=join(this.#dir,`.state-${randomUUID()}`);writeFileSync(temp,JSON.stringify(Object.fromEntries(next)),{mode:0o600,flag:'wx'});renameSync(temp,join(this.#dir,'state.json'));this.#rows=next;
 }
 close(){if(this.#lock){unlinkSync(this.#lock);this.#lock=null}}
}
