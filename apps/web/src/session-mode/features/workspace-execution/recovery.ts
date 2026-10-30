import {gitInspectWorktree} from "@session/services/apiAdapt/git";
import {readLocalEnvironmentReceipt} from "./api";
import {finishPreparedExecution,readExecutionContext,verifyExecutionContext,type ExecutionRecord} from "./state";

/** No negative native-history inference: this path is available only before native admission. */
export async function inspectPreparedExecution(record:ExecutionRecord,signal?:AbortSignal){
  if(record.phase!=="unknown"||!record.stage||record.stage==="native")throw new Error("原生创建可能已发送，必须核对精确会话，不能结束未知回执。");
  if(!record.preparation)throw new Error("旧创建记录缺少准备元数据，请人工核对原服务，不能据空会话列表解锁。");
  const native=await readExecutionContext();
  if(native.domain!==record.scope)throw new Error("原创建记录属于另一账号或服务，请切回原连接核对。");
  let cwd=record.root,description="未发送到原生的准备阶段";
  if(record.preparation.mode==="worktree"){
    const worktree=await gitInspectWorktree(record.root,record.id,signal);
    if(!worktree||!['registered','missing'].includes(worktree.state)||typeof worktree.worktree_path!=="string"||!worktree.worktree_path.startsWith("/"))throw new Error("工作树状态无法确认，请人工核对，不会清理或重复创建。");
    if(record.cwd&&record.cwd!==worktree.worktree_path)throw new Error("工作树目录与原创建记录不一致。");
    cwd=worktree.worktree_path;
    description=worktree.state==="registered"?`工作树已创建${worktree.dirty?"，包含未提交修改":""}；目录将保留。` : "本次工作树目录尚未创建。";
  }
  if(record.stage==="setup"){
    const receipt=await readLocalEnvironmentReceipt(record.root,record.id,signal);
    if(!receipt||receipt.status==="unknown")throw new Error("设置命令回执未知，请先核对原服务；不会重复执行。");
    if(!['completed','failed'].includes(receipt.status)||receipt.cwd!==cwd||receipt.environment!==record.preparation.environmentId||receipt.version!==record.preparation.environmentVersion)throw new Error("设置命令回执与原目录或配置不一致。");
    description+=` 设置命令已${receipt.status==="completed"?"完成":"失败"}；执行结果保留。`;
  }
  signal?.throwIfAborted();await verifyExecutionContext(native);signal?.throwIfAborted();
  return {scope:record.scope,root:record.root,stage:record.stage,cwd,description};
}
export async function settlePreparedExecution(record:ExecutionRecord,signal?:AbortSignal,beforeApply?:()=>void){
  const verified=await inspectPreparedExecution(record,signal);signal?.throwIfAborted();beforeApply?.();finishPreparedExecution(record.id,verified);
}
