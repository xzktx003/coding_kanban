import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {isMcpMetadata}=createRequire(import.meta.url)('../src/shared-mcp-wire.cjs');
const metadata=()=>({enabled:true,enabled_tools:[],omit_tools_from:['deferred'],default_tools_approval_mode:'prompt',startup_timeout_sec:10,tool_timeout_sec:3600});
test('fixed original MCP metadata rejects nested accessors without invoking them',()=>{
 const good=metadata();assert.equal(isMcpMetadata(good),true);let called=0;
 const dangerous=metadata();Object.defineProperty(dangerous.omit_tools_from,'0',{get(){called++;return 'deferred';}});
 assert.equal(isMcpMetadata(dangerous),false);assert.equal(called,0);
 const extra=metadata();extra.omit_tools_from.token='unexpected';assert.equal(isMcpMetadata(extra),false);
});
