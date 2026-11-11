import {captureCodexOperationScope,isCodexOperationScopeCurrent} from "@session/services/codexOperationScope";
import {useCallback,useEffect,useRef,useState} from 'react';
import {getJsonWithOptions} from '@session/services/apiAdapt/shared';
import {readWithDeadline} from '@session/services/sessionReadQueue';
import type {ReasoningEffort} from '@session/bindings';
export type MagpieModel = {id:string;reasoningEfforts?:ReasoningEffort[]};
const efforts = new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
export function useMagpieCatalog(open:boolean){
 const [state,setState]=useState<{models:MagpieModel[];error?:string;loading:boolean}>({models:[],loading:false});
 const serial=useRef(0);
 const refresh=useCallback(async()=>{
  const id=++serial.current;const scope=captureCodexOperationScope();setState({models:[],loading:true});
  try{
   const value=await readWithDeadline(signal=>getJsonWithOptions<{provider:string;models:MagpieModel[]}>('/model-catalog/magpie',{signal,suppressToast:true}),5500);
   if(value.models?.some(m=>m.reasoningEfforts!==undefined&&(!Array.isArray(m.reasoningEfforts)||m.reasoningEfforts.length>16||m.reasoningEfforts.some(e=>!efforts.has(e)))))throw Error();
   if(value.provider!=='magpie'||!Array.isArray(value.models)||value.models.length>2048||value.models.some(m=>typeof m.id!=='string'||!m.id||m.id.length>1024))throw Error();
   if(serial.current===id&&isCodexOperationScopeCurrent(scope))setState({models:value.models,loading:false});
  }catch{if(serial.current===id&&isCodexOperationScopeCurrent(scope))setState({models:[],loading:false,error:'Magpie 模型目录不可用'})}
 },[]);
 useEffect(()=>{if(open)void refresh();return()=>{serial.current++}},[open,refresh]);
 return {...state,refresh};
}
