// Create one short-lived CA and one IP-SAN server certificate under a fresh,
// owned evidence directory. No existing machine trust store or TLS files change.
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { chmod, lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readPrivateTlsFile, validateLanAddress, validateTlsMaterial } from './chatgpt-desktop-container-acceptance.mjs';

const exec=promisify(execFile),SHA=/^[a-f0-9]{64}$/;
const fail=code=>Object.assign(new Error(code),{code});
const pathOK=x=>typeof x==='string'&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
async function hash(path){const h=createHash('sha256');for await(const b of createReadStream(path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}))h.update(b);return h.digest('hex')}
export async function generateTlsFixture({evidenceRoot,ip,opensslPath,opensslSha256}){
 const uid=process.getuid?.();if(uid===undefined||uid===0||!pathOK(evidenceRoot)||!pathOK(opensslPath)||!SHA.test(opensslSha256??''))throw fail('TLS_FIXTURE_INVALID');
 validateLanAddress(ip,networkInterfaces());
 const dir=await lstat(evidenceRoot,{bigint:true}),tool=await lstat(opensslPath,{bigint:true});
 if(await realpath(evidenceRoot)!==evidenceRoot||!dir.isDirectory()||dir.uid!==BigInt(uid)||(dir.mode&0o7777n)!==0o700n||(await readdir(evidenceRoot)).length!==0||await realpath(opensslPath)!==opensslPath||!tool.isFile()||![0n,BigInt(uid)].includes(tool.uid)||(tool.mode&0o022n)!==0n||(tool.mode&0o111n)===0n||await hash(opensslPath)!==opensslSha256)throw fail('TLS_FIXTURE_UNSAFE');
 const tlsDir=join(evidenceRoot,'tls');await mkdir(tlsDir,{mode:0o700});
 const p=name=>join(tlsDir,name),temporary=['ca.key','server.csr','ca.srl','extensions.cnf'];
 const run=async args=>{try{await exec(opensslPath,args,{cwd:tlsDir,env:{HOME:tlsDir,PATH:'/usr/bin:/bin',LANG:'C',OPENSSL_CONF:'/dev/null'},timeout:15000,maxBuffer:8192,shell:false})}catch{throw fail('TLS_FIXTURE_GENERATION_FAILED')}};
 try{
  await run(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',p('ca.key'),'-out',p('ca.pem'),'-days','1','-subj','/CN=Desktop Acceptance CA','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign']);
  await run(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',p('server.key'),'-out',p('server.csr'),'-subj','/CN=Desktop Acceptance']);
  await writeFile(p('extensions.cnf'),`[v3]\nsubjectAltName=IP:${ip}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n`,{mode:0o600,flag:'wx'});
  await run(['x509','-req','-in',p('server.csr'),'-CA',p('ca.pem'),'-CAkey',p('ca.key'),'-CAcreateserial','-out',p('server.pem'),'-days','1','-extfile',p('extensions.cnf'),'-extensions','v3']);
  for(const name of ['ca.pem','server.pem','server.key'])await chmod(p(name),0o600);
  const result={tlsCaPath:p('ca.pem'),tlsCaSha256:await hash(p('ca.pem')),tlsCertPath:p('server.pem'),tlsCertSha256:await hash(p('server.pem')),tlsKeyPath:p('server.key'),tlsKeySha256:await hash(p('server.key'))};
  const [ca,cert,key]=await Promise.all([[result.tlsCaPath,result.tlsCaSha256],[result.tlsCertPath,result.tlsCertSha256],[result.tlsKeyPath,result.tlsKeySha256]].map(([path,sha])=>readPrivateTlsFile(path,sha)));
  validateTlsMaterial({ca,cert,key,ip});return Object.freeze(result);
 }finally{for(const name of temporary)await rm(p(name),{force:true}).catch(()=>{})}
}
async function main(){
 const names=['--evidence-dir','--ip','--openssl','--openssl-sha256'];if(process.argv.length!==10||names.some((x,i)=>process.argv[2+i*2]!==x))throw fail('TLS_FIXTURE_USAGE');
 const [, , , evidenceRoot, ,ip, ,opensslPath, ,opensslSha256]=process.argv;
 const result=await generateTlsFixture({evidenceRoot,ip,opensslPath,opensslSha256});process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))main().catch(e=>{process.stderr.write((/^TLS_FIXTURE_[A-Z_]+$/.test(e?.code??'')?e.code:'TLS_FIXTURE_FAILED')+'\n');process.exitCode=1});
