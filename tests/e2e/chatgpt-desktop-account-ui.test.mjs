import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAccountModeAction, canChooseOriginalCodex } from './chatgpt-desktop-account-ui-policy.mjs';

test('ChatGPT with New chat and one editable immediately opens unique original switcher once',()=>{
 const state={chatgpt:true,codex:false,newChat:true,editable:1,chatgptControls:1};
 assert.equal(decideAccountModeAction(state,{switcherClicks:0}),'open-original-switcher');
 assert.equal(decideAccountModeAction(state,{switcherClicks:1}),'wait');
 for(const patch of [{chatgptControls:0},{chatgptControls:2},{editable:0},{editable:2},{chatgpt:false},{codex:true}])assert.equal(decideAccountModeAction({...state,...patch},{switcherClicks:0}),'wait');
});

test('only one visible exact Codex menu item may be selected; Work is never selected',()=>{
 assert.equal(canChooseOriginalCodex({codexVisible:1,workVisible:1,menuOpened:true,clickedCodex:false}),true);
 for(const state of [{codexVisible:0,menuOpened:true},{codexVisible:2,menuOpened:true},{codexVisible:1,menuOpened:false},{codexVisible:1,menuOpened:true,clickedCodex:true}])assert.equal(canChooseOriginalCodex(state),false);
});

test('a settled ChatGPT home without a unique mode switcher fails promptly',async()=>{
 const {missingModeSwitcherTooLong}=await import('./chatgpt-desktop-account-ui-policy.mjs');const home={chatgpt:true,codex:false,newChat:true,editable:1,chatgptControls:0};
 assert.equal(missingModeSwitcherTooLong(home,9999),false);assert.equal(missingModeSwitcherTooLong(home,10000),true);
 assert.equal(missingModeSwitcherTooLong({...home,chatgptControls:1},10000),false);assert.equal(missingModeSwitcherTooLong({...home,chatgpt:false},10000),false);
});

test('unchanged ChatGPT after a completed original selection fails without a long empty wait',async()=>{
 const {switchUnsettledTooLong}=await import('./chatgpt-desktop-account-ui-policy.mjs');const state={chatgpt:true,codex:false,newChat:true};
 assert.equal(switchUnsettledTooLong(state,{clickedCodex:true},29999),false);assert.equal(switchUnsettledTooLong(state,{clickedCodex:true},30000),true);
 assert.equal(switchUnsettledTooLong(state,{clickedCodex:false},30000),false);assert.equal(switchUnsettledTooLong({...state,codex:true,projects:true,navigation:true,editable:1},{clickedCodex:true},30000),false);
});

test('unknown Work diagnostic does not assert active or disabled',async()=>{
 const {classifyObservedWork}=await import('./chatgpt-desktop-account-ui-policy.mjs');
 assert.equal(classifyObservedWork(null),'unknown');
 assert.equal(classifyObservedWork({enabled:false,ready:false,environmentPresent:false}),'disabled');
 assert.equal(classifyObservedWork({enabled:true,ready:false,environmentPresent:false}),'active');
 assert.equal(classifyObservedWork({enabled:false,ready:null,environmentPresent:false}),'unknown');
});

test('blank or partially loaded UI after Codex selection still has a bounded timeout',async()=>{
 const {switchUnsettledTooLong}=await import('./chatgpt-desktop-account-ui-policy.mjs');
 assert.equal(switchUnsettledTooLong({chatgpt:false,codex:false,newChat:false},{clickedCodex:true},30000),true);
 assert.equal(switchUnsettledTooLong({codex:true,newChat:true,projects:true,navigation:true,editable:1},{clickedCodex:true},30000),false);
});
