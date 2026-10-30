import { createHash,randomUUID } from "node:crypto";
import { mkdir,open,rename,rm,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "../core/json.js";
import { validateSessionId } from "./history.js";

/** Durable identity metadata only; scope follows the actual SDK history root. */
export class ClaudeSessionIdentity {
  private readonly root:string;
  constructor(dataHome:string,historyRoot:string){this.root=join(dataHome,".codexia","cc-session-identities",createHash("sha256").update(historyRoot).digest("hex"));}
  async remember(sessionId:string,nativeSessionId:string){
    validateSessionId(sessionId);validateSessionId(nativeSessionId);
    await mkdir(this.root,{recursive:true,mode:0o700});
    const target=join(this.root,`${sessionId}.json`),temporary=`${target}.${randomUUID()}.tmp`;
    try{await writeFile(temporary,JSON.stringify({version:1,sessionId,nativeSessionId}),{flag:"wx",mode:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
  }
  async resolve(sessionId:string){
    validateSessionId(sessionId);
    let file;
    try{file=await open(join(this.root,`${sessionId}.json`),"r");}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return sessionId;throw error;}
    try{
      const buffer=Buffer.alloc(1025),{bytesRead}=await file.read(buffer,0,buffer.length,0);
      if(bytesRead>1024)throw new HttpError(409,"Claude history identity metadata exceeds its budget");
      const value=JSON.parse(buffer.subarray(0,bytesRead).toString());
      if(value?.version!==1||value.sessionId!==sessionId||typeof value.nativeSessionId!=="string")throw new HttpError(409,"Claude history identity metadata is invalid");
      validateSessionId(value.nativeSessionId);return value.nativeSessionId as string;
    }catch(error){if(error instanceof SyntaxError)throw new HttpError(409,"Claude history identity metadata is invalid");throw error;}
    finally{await file.close();}
  }
}
