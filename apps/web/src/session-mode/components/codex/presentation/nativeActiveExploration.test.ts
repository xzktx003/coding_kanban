import { expect, it } from "vitest";
import { nativeActiveExploration, nativeReadSkill } from "./nativeActiveExploration";
it("uses native read basename and displayLabel rather than a mismatched command name", () => {
  expect(nativeActiveExploration({type:"read",command:"cat actual.ts",name:"different",path:"./src/actual.ts"})).toEqual({key:"nativeReading",values:{target:"actual.ts"}});
  expect(nativeActiveExploration({type:"read",command:"cat",name:"fallback",path:null,displayLabel:"Friendly"} as any)).toEqual({key:"nativeReading",values:{target:"Friendly"}});
});
it("folder searches take precedence over the query and normalize native folder paths", () => {
  expect(nativeActiveExploration({type:"search",command:"rg term",query:"term",path:"./src\\nested"})).toEqual({key:"nativeSearchingFolder",values:{folder:"src/nested"}});
  expect(nativeActiveExploration({type:"search",command:"rg term",query:"term",path:null})).toEqual({key:"nativeSearchingQuery",values:{query:"term"}});
  expect(nativeActiveExploration({type:"search",command:"rg",query:null,path:null})).toEqual({key:"nativeSearchingFiles",values:{}});
  expect(nativeActiveExploration({type:"listFiles",command:"ls",path:"./src"})).toEqual({key:"nativeListingFolder",values:{folder:"src"}});
});
it("recognizes only native skill definition roots and the canonical system knowledge skill", () => {
  const read=(path:string)=>({type:"read" as const,command:"cat",name:"SKILL.md",path});
  expect(nativeActiveExploration(read("/owner/.agents/skills/grill_me/SKILL.md"))).toEqual({key:"nativeReadingSkill",values:{skillName:"Grill Me"}});
  expect(nativeActiveExploration(read("/owner/.codex/skills/.system/internal-knowledge/SKILL.md"))).toEqual({key:"nativeReadingInternalKnowledge",values:{}});
  expect(nativeActiveExploration(read("/owner/.codex/plugins/cache/official/visualize/1.0/skills/live/SKILL.md"))).toEqual({key:"nativeReadingSkill",values:{skillName:"Live"}});
  expect(nativeReadSkill(read("/owner/project/SKILL.md"))).toBeNull();
  expect(nativeReadSkill(read("/owner/.agents/skills/custom/scripts/run.py"))).toBeNull();
  expect(nativeActiveExploration(read("/owner/.agents/skills/internal-knowledge/SKILL.md"))).toEqual({key:"nativeReadingSkill",values:{skillName:"Internal Knowledge"}});
});
