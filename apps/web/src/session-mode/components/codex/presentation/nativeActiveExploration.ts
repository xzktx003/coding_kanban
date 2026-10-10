import type { CommandAction } from "@session/bindings/v2";
/** Native vxt/bxt path and skill rules, VSIX 26.51002.51308. */
const normalize = (path: string) => path.trim().replace(/^\.\/+/, "").replaceAll("\\", "/");
const skillTitle = (id: string) => id.split(":").map(part => part.replace(/([a-z\d])([A-Z])/g,"$1 $2").split(/[-_\s]+/).filter(Boolean).map(word=>word[0].toUpperCase()+word.slice(1)).join(" ")).join(": ");
export function nativeReadSkill(action: CommandAction): { skillName:string; internalKnowledge:boolean } | null {
  if (action.type !== "read") return null;
  const segments=normalize(action.path ?? action.name).split("/").filter(Boolean);
  const lower=segments.map(segment=>segment.toLowerCase());
  let id: string | undefined, system=false, plugin=false;
  for(let index=0;index<segments.length;index++) {
    if ((lower[index] === ".codex" || lower[index] === ".agents") && lower[index+1] === "skills") {
      const category=lower[index+2];
      const skillIndex=index+(category === ".system" || category === "_import" ? 3 : 2);
      if(skillIndex+2!==segments.length || lower[skillIndex+1]!=="skill.md") return null;
      id=segments[skillIndex]; system=category === ".system"; break;
    }
    if(lower[index] === "plugins") {
      const cached=lower[index+1] === "cache", pluginIndex=index+(cached?3:1), after=pluginIndex+(cached?1:0);
      const skillSegment=lower.findIndex((value,position)=>position>after && value === "skills");
      const skillIndex=skillSegment<0?after:skillSegment+1;
      if(skillIndex+2!==segments.length || lower[skillIndex+1]!=="skill.md") return null;
      id=skillSegment<0?segments[pluginIndex]:segments[skillIndex]; plugin=true; break;
    }
  }
  return id ? {skillName:skillTitle(id),internalKnowledge:system&&!plugin&&id === "internal-knowledge"} : null;
}
export function nativeActiveExploration(action: CommandAction): { key:string; values:Record<string,string> } {
  if(action.type === "read") {
    const skill=nativeReadSkill(action);
    if(skill?.internalKnowledge) return {key:"nativeReadingInternalKnowledge",values:{}};
    if(skill) return {key:"nativeReadingSkill",values:{skillName:skill.skillName}};
    const displayLabel=(action as typeof action & {displayLabel?:string}).displayLabel;
    return {key:"nativeReading",values:{target:displayLabel??normalize(action.path??action.name).replace(/\/+$/," ").trim().split("/").at(-1)??action.name}};
  }
  if(action.type === "search") return action.path
    ? {key:"nativeSearchingFolder",values:{folder:normalize(action.path)}}
    : action.query ? {key:"nativeSearchingQuery",values:{query:action.query}} : {key:"nativeSearchingFiles",values:{}};
  if(action.type === "listFiles") return action.path == null
    ? {key:"nativeListingFiles",values:{}} : {key:"nativeListingFolder",values:{folder:normalize(action.path)}};
  return {key:"nativeRunningCommand",values:{command:action.command.trim()}};
}
