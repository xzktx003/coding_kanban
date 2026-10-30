import { ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { readClaudePermissionInput } from '@session/services/claudePermissionDetail';
import { Button } from '@session/components/ui/button';
import { Card } from '@session/components/ui/card';
import { cn } from '@session/lib/utils';
import type { PermissionRequestMessage } from '../../types/messages';
import type { PermissionDecision } from '../../types/permission';
import { NO_RAW_INPUT_TOOLS } from '.';
import { ToolInputDisplay } from './ToolInputDisplay';
import {
  AskUserQuestionTool,
  BashTool,
  EditTool,
  GlobTool,
  GrepTool,
  ReadTool,
  TodoWriteTool,
  WriteTool,
} from './tool-use';

const RESOLVED_LABEL: Record<PermissionDecision, string> = {
  allow: 'Allowed Once',
  allow_always: 'Always Allowed (Session)',
  allow_project: 'Always Allowed (Project)',
  deny: 'Denied',
};

interface Props {
  msg: PermissionRequestMessage;
  onResolve: (id: string, decision: PermissionDecision) => void | Promise<void>;
  active?: boolean;
}

export function PermissionRequestCard({ msg, onResolve,active=true }: Props) {
  const resolved = msg.resolved;
  const [fullInput,setFullInput]=useState<Record<string,unknown>|null>(null),[loading,setLoading]=useState(false),[detailError,setDetailError]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);
  const [decisionPending,setDecisionPending]=useState(false);
  useEffect(()=>{setFullInput(null);setDetailError(null);setLoading(false);return()=>controller.current?.abort();},[msg.requestId,msg.recoveryRuntimeInstance,msg.inputRevision]);
  useEffect(()=>{if(resolved){controller.current?.abort();setFullInput(null);setLoading(false);}},[resolved]);
  useEffect(()=>{
    const release=()=>{if(!active||document.hidden){controller.current?.abort();setFullInput(null);setLoading(false);}};
    release();document.addEventListener('visibilitychange',release);return()=>document.removeEventListener('visibilitychange',release);
  },[active]);
  const incomplete=!!msg.toolInputTruncated&&!fullInput;
  const canApprove=active&&!decisionPending&&!incomplete&&msg.inputAvailable!==false;
  const performResolve=async(decision:PermissionDecision)=>{
    if(decisionPending||!active)return;setDecisionPending(true);setDetailError(null);
    try{await onResolve(msg.requestId,decision);}catch(error){setDetailError(error instanceof Error?error.message:String(error));}finally{setDecisionPending(false);}
  };
  const toolInput=fullInput??msg.toolInput;
  const load=async()=>{
    if(!active||document.hidden)return;
    const request=new AbortController();controller.current?.abort();controller.current=request;setLoading(true);setDetailError(null);
    try{const input=await readClaudePermissionInput(msg,request.signal);if(!request.signal.aborted)setFullInput(input);}catch(error){if(!request.signal.aborted)setDetailError(error instanceof Error?error.message:String(error));}finally{if(!request.signal.aborted)setLoading(false);}
  };

  return (
    <Card className="p-4 border-amber-500/30 bg-amber-500/5 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 text-amber-600 dark:text-amber-400">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <span className="text-sm font-semibold uppercase tracking-wide">Permission Request</span>
      </div>

      {/* Tool info */}
      <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-background/50 border border-amber-500/20 text-xs mb-3">
        {!NO_RAW_INPUT_TOOLS.includes(msg.toolName) && (
          <div className="flex items-center gap-2">
            <span className="font-medium text-muted-foreground">Tool:</span>
            <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-amber-600 dark:text-amber-400">
              {msg.toolName}
            </code>
          </div>
        )}
        {incomplete ? <div role="status"><p>{msg.inputError??'完整审批参数需按需读取；读取完成前保留拒绝入口。'}</p>{msg.inputAvailable&&<Button type="button" size="sm" variant="outline" disabled={loading} onClick={()=>void load()}>{loading?'正在读取完整参数…':'查看完整审批参数'}</Button>}{detailError&&<p role="alert">{detailError}</p>}</div> : NO_RAW_INPUT_TOOLS.includes(msg.toolName) ? (
          (() => {
            const block = {
              type: 'tool_use',
              name: msg.toolName,
              input: toolInput,
              id: msg.requestId,
            } as any;
            const errorProps = { inlineError: null, showError: false, onToggleError: () => {} };
            switch (msg.toolName) {
              case 'Read':
                return <ReadTool block={block} {...errorProps} />;
              case 'Edit':
                return <EditTool block={block} {...errorProps} />;
              case 'Write':
                return <WriteTool block={block} {...errorProps} />;
              case 'Bash':
                return <BashTool block={block} {...errorProps} />;
              case 'Glob':
                return <GlobTool block={block} {...errorProps} />;
              case 'Grep':
                return <GrepTool block={block} {...errorProps} />;
              case 'TodoWrite':
                return <TodoWriteTool block={block} {...errorProps} />;
              case 'AskUserQuestion':
                return <AskUserQuestionTool block={block} {...errorProps} />;
              default:
                return null;
            }
          })()
        ) : (
          <ToolInputDisplay
            input={toolInput}
            highlightKeys={['file_path', 'path', 'command']}
          />
        )}
      </div>

      {/* Resolved state */}
      {resolved ? (
        <div
          className={cn(
            'text-[10px] font-bold px-2 py-1.5 rounded-md border text-center uppercase tracking-widest flex items-center justify-center gap-1.5',
            resolved === 'deny'
              ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
          )}
        >
          {resolved === 'deny' ? <X className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
          {RESOLVED_LABEL[resolved] ?? resolved}
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-red-500/30 text-red-500 hover:bg-red-500/5"
            onClick={() => void performResolve('deny')}
            disabled={decisionPending||!active}
          >
            Deny
          </Button>
          {msg.alwaysAllowTarget === 'project' ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
              onClick={() => void performResolve('allow_project')}
              disabled={!canApprove}
            >
              <ShieldCheck className="w-3 h-3 mr-1" /> Always Allow (project)
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              onClick={() => void performResolve('allow_always')}
              disabled={!canApprove}
            >
              <ShieldCheck className="w-3 h-3 mr-1" /> Always Allow (session)
            </Button>
          )}
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
            onClick={() => void performResolve('allow')}
            disabled={!canApprove}
          >
            Allow Once
          </Button>
        </div>
      )}
      {detailError&&!incomplete&&<p role="alert" className="mt-2 text-xs text-red-500">{detailError}</p>}
    </Card>
  );
}
