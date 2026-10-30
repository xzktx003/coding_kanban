import { lazy, Suspense, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@session/components/ui/button";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { OptionalSessionPanel } from "@session/components/layout/OptionalSessionPanel";
const Panel=lazy(()=>import("./ExecutionLocationPanel").then(module=>({default:module.ExecutionLocationPanel})));
/** The settings and Git lists are loaded only after an explicit gesture. */
export function ExecutionLocationPicker({owner,disabled=false}:{owner:string;disabled?:boolean}){
 const [open,setOpen]=useState(false),root=useWorkspaceStore(state=>state.cwd);
 useEffect(()=>setOpen(false),[owner,root]);
 return <><Button type="button" size="sm" variant="ghost" disabled={disabled||!root} aria-label="配置本地工作环境" onClick={()=>setOpen(true)} className="h-7 gap-1 px-1.5 text-xs text-muted-foreground"><Settings2 className="h-3.5 w-3.5"/><span>工作环境</span></Button>{open&&root&&<OptionalSessionPanel label="本地工作环境" onClose={()=>setOpen(false)} overlay><Suspense fallback={<div role="status" className="rounded-md border bg-background p-3 text-sm">正在加载工作环境…<Button type="button" variant="ghost" size="sm" onClick={()=>setOpen(false)}>取消</Button></div>}><Panel root={root} owner={owner} onClose={()=>setOpen(false)}/></Suspense></OptionalSessionPanel>}</>;
}
