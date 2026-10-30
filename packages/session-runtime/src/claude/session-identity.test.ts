import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {ClaudeSessionIdentity} from "./session-identity.js";
test("Claude logical/native identity survives a new reader, stays in the SDK history namespace, and rejects path input",async()=>{
  const home=await mkdtemp(join(tmpdir(),"cc-identities-"));
  try{
    const owner=new ClaudeSessionIdentity(home,"/sdk/source-one");await owner.remember("wrapper","native-id");
    assert.equal(await new ClaudeSessionIdentity(home,"/sdk/source-one").resolve("wrapper"),"native-id");
    assert.equal(await new ClaudeSessionIdentity(home,"/sdk/source-two").resolve("wrapper"),"wrapper");
    await assert.rejects(owner.resolve("../foreign"),/session/);await assert.rejects(owner.remember("wrapper","../foreign"),/session/);
  }finally{await rm(home,{recursive:true,force:true});}
});
