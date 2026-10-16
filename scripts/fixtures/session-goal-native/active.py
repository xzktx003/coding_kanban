#!/usr/bin/env python3
"""Real native Goal scheduling with deterministic local Responses, never a model."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from connect_guard import start_connect_guard

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(); parser.add_argument("--cli", required=True); parser.add_argument("--output-dir", required=True); parser.add_argument("--scenario", choices=["probe", "full", "cas"], default="probe")
args = parser.parse_args(); binary = Path(args.cli).resolve(strict=True)
base = Path(tempfile.mkdtemp(prefix="run-", dir=Path(args.output_dir).resolve(strict=True))); base.chmod(0o700)
for name in ("home", "cli", "tmp", "config", "cache", "data", "project"):
    (base / name).mkdir(mode=0o700)
env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL") if key in os.environ}
env.update(HOME=str(base / "home"), CODEX_HOME=str(base / "cli"), TMPDIR=str(base / "tmp"),
    XDG_CONFIG_HOME=str(base / "config"), XDG_CACHE_HOME=str(base / "cache"), XDG_DATA_HOME=str(base / "data"),
    DO_NOT_TRACK="1", OTEL_SDK_DISABLED="true", NO_PROXY="127.0.0.1", no_proxy="127.0.0.1")
timeline = []; timeline_lock = threading.Lock(); ledger = (base / "timeline.jsonl").open("w", buffering=1)
def record(kind, payload):
    with timeline_lock:
        entry = {"order": len(timeline) + 1, "monotonicSeconds": round(time.monotonic(), 6), "kind": kind, **payload}
        timeline.append(entry); ledger.write(json.dumps(entry) + "\n")
        return entry
def until(check, label, seconds=12):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = check()
        if value: return value
        time.sleep(.04)
    raise TimeoutError(label)
def flatten_tools(tools, namespace=None):
    result=[]
    for tool in tools:
        if isinstance(tool.get("tools"), list): result += flatten_tools(tool["tools"], tool.get("name", namespace))
        elif tool.get("name"): result.append({"namespace": namespace, **tool})
    return result

class Fixture:
    def __init__(self):
        self.calls=[]; self.lock=threading.Lock(); self.mode={"new":"hold-first", "pause":"warmup", "blocked":"blocked", "usage":"complete"}
        self.generation={case:0 for case in self.mode}; self.issued=set()
        self.release_events={case:threading.Event() for case in self.mode}; self.schemas={}; self.errors=[]
        fixture=self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*_): pass
            def do_POST(self):
                if self.path != "/v1/responses": self.send_error(404); return
                length=int(self.headers.get("content-length","0"))
                if length>16*1024*1024: self.send_error(413); return
                body=json.loads(self.rfile.read(length)); serialized=json.dumps(body.get("input",[]))
                case=next((case for case in fixture.mode if "GOAL_NATIVE_"+case.upper() in serialized), "unknown")
                with fixture.lock:
                    index=len(fixture.calls)+1; case_count=sum(call["case"]==case for call in fixture.calls)+1
                    mode=fixture.mode.get(case,"unknown"); generation=fixture.generation.get(case,0)
                    phase_count=sum(call['case']==case and call['generation']==generation for call in fixture.calls)+1
                    tools=flatten_tools(body.get("tools",[]))
                    goals=[tool for tool in tools if "goal" in tool.get("name","")]
                    for tool in goals: fixture.schemas[tool["name"]]=tool
                    call={"index":index,"case":case,"caseCount":case_count,"generation":generation,"phaseCount":phase_count,"mode":mode,"authorizationHeaderPresent":bool(self.headers.get('authorization')),"goalTools":goals,
                          "inputTypes":[item.get("type",item.get("role")) for item in body.get("input",[])],
                          "functionResults":[item for item in body.get("input",[]) if item.get("type")=="function_call_output"][-2:]}
                    fixture.calls.append(call)
                (base / ("provider-request-%02d.json" % index)).write_text(json.dumps(body,ensure_ascii=False,indent=2)+"\n")
                record("provider.request",call)
                rid="goal-offline-%d" % index
                self.send_response(200); self.send_header("content-type","text/event-stream"); self.send_header("cache-control","no-store"); self.end_headers()
                def send(value):
                    record("provider.event",{"case":case,"request":index,"event":value})
                    self.wfile.write(("data: "+json.dumps(value)+"\n\n").encode());self.wfile.flush()
                try:
                    send({"type":"response.created","response":{"id":rid}})
                    held=(case=="new" and case_count==1) or mode=="hold"
                    if held:
                        if not fixture.release_events[case].wait(15): raise TimeoutError("held response not released")
                    goal_tool=next((tool for tool in goals if tool["name"]=="update_goal"),None)
                    target="blocked" if mode=="blocked" else "complete"
                    issue_key=(case,generation,target)
                    use_tool=(mode=="complete" or (mode=="blocked" and phase_count>=3) or (case=="new" and case_count>1)) and issue_key not in fixture.issued
                    if use_tool:
                        if not goal_tool: raise RuntimeError("Native request did not advertise update_goal")
                        schema=goal_tool.get("parameters",{})
                        property_schema=schema.get("properties",{}).get("status",{})
                        statuses=property_schema.get("enum")
                        if statuses is not None and target not in statuses: raise RuntimeError("Native update_goal schema excludes "+target)
                        required=schema.get("required",[])
                        if set(required)-{"status"}: raise RuntimeError("Unknown required update_goal fields: "+repr(required))
                        item={"type":"function_call","id":rid+"-goal","call_id":rid+"-goal","name":"update_goal","arguments":json.dumps({"status":target})}
                        if goal_tool.get("namespace"):item["namespace"]=goal_tool["namespace"]
                        fixture.issued.add(issue_key)
                    else:
                        item={"type":"message","id":rid+"-message","role":"assistant","content":[{"type":"output_text","text":"OFFLINE_"+case.upper()+"_STEP_DONE"}]}
                    send({"type":"response.output_item.done","item":item})
                    send({"type":"response.completed","response":{"id":rid,"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}})
                except (BrokenPipeError,ConnectionResetError): pass
                except Exception as error:
                    fixture.errors.append(repr(error));record("provider.error",{"case":case,"request":index,"error":repr(error)})
        self.server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);self.server.daemon_threads=True
        self.port=self.server.server_port
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
    def set_mode(self,case,mode):
        with self.lock:self.mode[case]=mode;self.generation[case]+=1
    def close(self):
        for event in self.release_events.values():event.set()
        self.server.shutdown();self.server.server_close()

class Native:
    def __init__(self,port):
        control,child_control=socket.socketpair(); self.error_file=(base/'native.stderr.log').open('w')
        self.process=subprocess.Popen(['strace','-f','-e','trace=network','-o',str(base/'native.network.log'),sys.executable,
            str(HERE/'loopback-only-exec.py'),str(child_control.fileno()),str(binary),'app-server','-c','thread_unload_delay_secs=1'],
            pass_fds=(child_control.fileno(),),cwd=base/'project',env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.error_file,text=True,start_new_session=True)
        child_control.close();self.decisions,self.close_guard=start_connect_guard(control,port,base/'network-decisions.jsonl');control.close()
        self.condition=threading.Condition();self.responses={};self.events=[];self.next=0
        def reader():
            for line in self.process.stdout:
                message=json.loads(line);record('native.receive',{'message':message})
                with self.condition:
                    self.events.append(message)
                    if 'id' in message and 'method' not in message:self.responses[message['id']]=message
                    self.condition.notify_all()
        threading.Thread(target=reader,daemon=True).start()
        try:
            self.initialized=self.call('initialize',{'clientInfo':{'name':'goal_active_offline_acceptance','version':'1'},'capabilities':{'experimentalApi':True}})
            self.notify('initialized',{})
        except Exception:self.close();raise
    def notify(self,method,params):
        message={'method':method,'params':params};record('native.send',{'message':message});self.process.stdin.write(json.dumps(message)+'\n');self.process.stdin.flush()
    def response(self,method,params):
        self.next+=1;identity=self.next;message={'id':identity,'method':method,'params':params};record('native.send',{'message':message});self.process.stdin.write(json.dumps(message)+'\n');self.process.stdin.flush()
        end=time.monotonic()+15
        with self.condition:
            while identity not in self.responses:
                if self.process.poll() is not None:raise RuntimeError('Own native exited')
                left=end-time.monotonic()
                if left<=0:raise TimeoutError(method)
                self.condition.wait(min(left,.1))
            return self.responses.pop(identity)
    def call(self,method,params):
        response=self.response(method,params)
        if 'error' in response:raise RuntimeError(method+': '+json.dumps(response['error']))
        return response['result']
    def goal(self,thread):return self.call('thread/goal/get',{'threadId':thread})['goal']
    def turn_done(self,thread,turn=None):
        return next((event for event in reversed(self.events) if event.get('method')=='turn/completed' and event.get('params',{}).get('threadId')==thread and (turn is None or event['params']['turn']['id']==turn)),None)
    def goal_event(self,thread,status):
        return next((event for event in reversed(self.events) if event.get('method')=='thread/goal/updated' and event.get('params',{}).get('threadId')==thread and event['params']['goal']['status']==status),None)
    def started_turn(self,thread):
        return next((event['params']['turn']['id'] for event in reversed(self.events) if event.get('method')=='turn/started' and event.get('params',{}).get('threadId')==thread),None)
    def close(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid,signal.SIGTERM)
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(self.process.pid,signal.SIGKILL);self.process.wait(timeout=5)
        self.close_guard();self.error_file.close()

fixture=Fixture();native=None
(base/'cli'/'config.toml').write_text('''model = "goal-offline-fixture"
model_provider = "goal_offline"
model_reasoning_effort = "high"
approval_policy = "never"
sandbox_mode = "read-only"
[features]
goals = true
[model_providers.goal_offline]
name = "Own deterministic loopback Goal Responses fixture"
base_url = "http://127.0.0.1:%d/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
''' % fixture.port)
report={'passed':False,'scenario':args.scenario,'artifactDirectory':str(base),'binary':{'path':str(binary),'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()},
    'isolation':{'privateHome':str(base/'home'),'privateCodexHome':str(base/'cli'),'authCopied':False,'providerAddress':'127.0.0.1','providerPort':fixture.port,'actualModelCalls':0},'checks':{}}
class ScenarioComplete(Exception):pass
try:
    native=Native(fixture.port);report['initialize']=native.initialized
    if args.scenario=='cas':
        thread=native.call('thread/start',{'cwd':str(base/'project'),'approvalPolicy':'never','sandbox':'read-only'})['thread']['id']
        native.call('thread/goal/set',{'threadId':thread,'objective':'Private compare-and-clear metadata fixture','status':'paused','tokenBudget':100})
        captured=native.call('thread/goal/set',{'threadId':thread,'status':'complete'})['goal']
        changed_before=native.call('thread/goal/set',{'threadId':thread,'objective':'A newer completed goal that must be preserved','status':'complete','tokenBudget':100})['goal']
        # Require the same-second counterexample, so a future timestamp-only
        # implementation cannot be mistaken for a full-snapshot condition.
        for attempt in range(3):
            if all(captured[key]==changed_before[key] for key in ('createdAt','updatedAt')):break
            if attempt==2:raise RuntimeError('CAS fixture could not create same-second A/B; no capability conclusion')
            captured=native.call('thread/goal/set',{'threadId':thread,'objective':'Private compare-and-clear metadata fixture','status':'complete','tokenBudget':100})['goal']
            changed_before=native.call('thread/goal/set',{'threadId':thread,'objective':'A newer completed goal that must be preserved','status':'complete','tokenBudget':100})['goal']
        refused=native.response('thread/goal/clear',{'threadId':thread,'ifGoalUnchanged':captured})
        remaining=native.goal(thread)
        supported=refused.get('result',{}).get('cleared') is False and remaining==changed_before
        report['checks']['conditionalClearRejectsDifferentFullGoal']={'passed':supported,'captured':captured,'newerGoalBeforeClear':changed_before,'response':refused,'goalAfter':remaining}
        if supported:
            changed=native.call('thread/goal/set',{'threadId':thread,'objective':'A different completed goal in the same second','status':'complete','tokenBudget':100})['goal']
            stale=native.call('thread/goal/clear',{'threadId':thread,'ifGoalUnchanged':captured})
            assert stale=={'cleared':False} and native.goal(thread)==changed
            exact=native.call('thread/goal/clear',{'threadId':thread,'ifGoalUnchanged':changed})
            assert exact=={'cleared':True} and native.goal(thread) is None
            report['checks']['conditionalClearAcceptsOnlyExactFullGoal']={'passed':True,'previousUpdatedAt':captured['updatedAt'],'changedUpdatedAt':changed['updatedAt'],'staleResponse':stale,'exactResponse':exact}
        report['passed']=supported and not fixture.errors
        report['nativeCompareAndClearSupported']=supported
        raise ScenarioComplete()
    thread=native.call('thread/start',{'cwd':str(base/'project'),'approvalPolicy':'never','sandbox':'read-only'})['thread']['id']
    objective='GOAL_NATIVE_NEW verify deterministic native Goal continuation'
    first=native.call('turn/start',{'threadId':thread,'input':[{'type':'text','text':'/goal '+objective,'text_elements':[]}]})['turn']['id']
    activated=native.call('thread/goal/set',{'threadId':thread,'objective':objective,'status':'active','tokenBudget':100})
    turn_send=next(entry for entry in timeline if entry['kind']=='native.send' and entry['message'].get('method')=='turn/start')
    turn_ack=next(entry for entry in timeline if entry['kind']=='native.receive' and entry['message'].get('id')==turn_send['message']['id'] and 'result' in entry['message'])
    goal_send=next(entry for entry in timeline if entry['kind']=='native.send' and entry['message'].get('method')=='thread/goal/set')
    assert turn_send['order']<turn_ack['order']<goal_send['order']
    report['checks']['newGoalAcceptedOrder']={'passed':True,'threadId':thread,'initialTurnId':first,'goal':activated['goal'],
        'turnStartSendOrder':turn_send['order'],'turnStartAckOrder':turn_ack['order'],'goalSetSendOrder':goal_send['order']}
    until(lambda:any(call['case']=='new' for call in fixture.calls),'first local provider call')
    fixture.release_events['new'].set()
    completion=until(lambda:native.goal_event(thread,'complete'),'new Goal native update_goal completion')
    completion_turn=completion['params']['turnId'];assert completion_turn and completion_turn!=first
    until(lambda:native.turn_done(thread,completion_turn),'new Goal exact final turn completion')
    assert '/goal '+objective in json.dumps(json.loads((base/'provider-request-01.json').read_text())['input'])
    report['checks']['newGoalContinuationAndComplete']={'passed':True,'goal':native.goal(thread),'providerCalls':len(fixture.calls),'completedGoalTurnId':completion_turn}
    if args.scenario=='full':
        paused_thread=native.call('thread/start',{'cwd':str(base/'project'),'approvalPolicy':'never','sandbox':'read-only'})['thread']['id']
        warmup=native.call('turn/start',{'threadId':paused_thread,'input':[{'type':'text','text':'WARMUP_GOAL_NATIVE_PAUSE','text_elements':[]}]})['turn']['id']
        until(lambda:native.turn_done(paused_thread,warmup),'idle fixture warmup completion')
        fixture.set_mode('pause','hold');before_calls=len(fixture.calls)
        existing=native.call('thread/goal/set',{'threadId':paused_thread,'objective':'GOAL_NATIVE_PAUSE test explicit pause and resume','status':'active','tokenBudget':100})
        until(lambda:len(fixture.calls)>before_calls,'setting active on existing idle thread starts native work')
        active_turn=until(lambda:native.started_turn(paused_thread) if native.started_turn(paused_thread)!=warmup else None,'goal auto turn identity')
        paused=native.call('thread/goal/set',{'threadId':paused_thread,'status':'paused'})
        assert paused['goal']['status']=='paused'
        pause_calls=len(fixture.calls);fixture.release_events['pause'].set()
        pause_end=until(lambda:native.turn_done(paused_thread,active_turn),'current turn after Goal pause')
        time.sleep(1.25);assert len(fixture.calls)==pause_calls,'Paused Goal scheduled another model turn'
        report['checks']['existingIdleActivationAndPause']={'passed':True,'threadId':paused_thread,'warmupTurn':warmup,'autoTurn':active_turn,
            'pauseAck':paused,'endedTurnStatus':pause_end['params']['turn']['status'],'providerCallsDuringQuietWindow':0,'quietWindowSeconds':1.25}
        fixture.set_mode('pause','complete');native.call('thread/goal/set',{'threadId':paused_thread,'status':'active'})
        resumed_complete=until(lambda:native.goal_event(paused_thread,'complete'),'paused Goal resume completion')
        resumed_turn=resumed_complete['params']['turnId'];assert resumed_turn and resumed_turn!=active_turn
        until(lambda:native.turn_done(paused_thread,resumed_turn),'paused Goal exact resumed turn completion')
        report['checks']['pausedResumeAndComplete']={'passed':True,'goal':native.goal(paused_thread),'resumedTurn':resumed_turn}
        blocked_thread=native.call('thread/start',{'cwd':str(base/'project'),'approvalPolicy':'never','sandbox':'read-only'})['thread']['id']
        native.call('thread/goal/set',{'threadId':blocked_thread,'objective':'GOAL_NATIVE_BLOCKED same deterministic fixture blocker; after three Goal turns mark blocked','status':'active','tokenBudget':100})
        blocked_event=until(lambda:native.goal_event(blocked_thread,'blocked'),'model update_goal blocked after three native Goal turns')
        blocked_turn=blocked_event['params']['turnId'];assert blocked_turn
        until(lambda:native.turn_done(blocked_thread,blocked_turn),'blocked Goal exact turn completion')
        blocked_goal_turns=[event for event in native.events if event.get('method')=='turn/started' and event.get('params',{}).get('threadId')==blocked_thread]
        assert len(blocked_goal_turns)>=3
        blocked_calls=len(fixture.calls);time.sleep(.75);assert len(fixture.calls)==blocked_calls
        report['checks']['blockedStopsAfterThreeTurns']={'passed':True,'threadId':blocked_thread,'goalTurnCount':len(blocked_goal_turns),'goal':native.goal(blocked_thread),'quietWindowSeconds':.75}
        fixture.set_mode('blocked','complete');native.call('thread/goal/set',{'threadId':blocked_thread,'status':'active'})
        unblocked=until(lambda:native.goal_event(blocked_thread,'complete'),'blocked Goal explicit resume completion')
        until(lambda:native.turn_done(blocked_thread,unblocked['params']['turnId']),'blocked Goal exact resumed turn completion')
        report['checks']['blockedResumeAndComplete']={'passed':True,'goal':native.goal(blocked_thread),'resumedTurn':unblocked['params']['turnId']}
        usage_thread=native.call('thread/start',{'cwd':str(base/'project'),'approvalPolicy':'never','sandbox':'read-only'})['thread']['id']
        usage=native.response('thread/goal/set',{'threadId':usage_thread,'objective':'GOAL_NATIVE_USAGE explicit fixture metadata recovery only','status':'usageLimited','tokenBudget':100})
        if 'error' in usage:
            report['usageLimitedBoundary']={'attempted':'Explicit metadata state only; no real quota failure was simulated','response':usage}
        else:
            assert usage['result']['goal']['status']=='usageLimited'
            native.call('thread/goal/set',{'threadId':usage_thread,'status':'active'})
            restored=until(lambda:native.goal_event(usage_thread,'complete'),'usageLimited metadata state explicit resume')
            until(lambda:native.turn_done(usage_thread,restored['params']['turnId']),'usageLimited metadata exact resumed turn completion')
            report['checks']['usageLimitedMetadataResume']={'passed':True,'boundary':'Explicit API-seeded state; not actual provider quota detection','goal':native.goal(usage_thread)}
    report['passed']=not fixture.errors and all(check.get('passed') is True for check in report['checks'].values())
except ScenarioComplete:pass
except Exception as error:report['error']=repr(error)
finally:
    fixture.close()
    if native:native.close()
    report['providerErrors']=fixture.errors;report['providerCalls']=fixture.calls;report['observedGoalTools']=fixture.schemas
    report['isolation']['authFilesCreated']=[str(path.relative_to(base)) for path in base.rglob('auth.json')]
    report['isolation']['connectDecisions']=native.decisions if native else []
    report['isolation']['allAllowedConnectionsOwnProvider']=all(not item.get('allowed') or (item.get('address')=='127.0.0.1' and item.get('port')==fixture.port) for item in (native.decisions if native else []))
    report['isolation']['ownProcessExited']=native.process.poll() is not None if native else True
    audit_errors=[]
    if report['isolation']['authFilesCreated']:audit_errors.append('Unexpected auth.json created')
    if not report['isolation']['ownProcessExited']:audit_errors.append('Owned native did not exit')
    if not report['isolation']['allAllowedConnectionsOwnProvider']:audit_errors.append('Connection admitted outside own provider')
    if any('guardError' in item or 'replyError' in item for item in report['isolation']['connectDecisions']):audit_errors.append('Connection guard error')
    if any(call.get('authorizationHeaderPresent') for call in fixture.calls):audit_errors.append('Unexpected Authorization header')
    if args.scenario!='cas' and not any(item.get('allowed') is True for item in report['isolation']['connectDecisions']):audit_errors.append('No verified allowed loopback connect')
    report['isolation']['auditErrors']=audit_errors
    report['passed']=report['passed'] and not audit_errors
    ledger.close();(base/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'passed':report['passed'],'artifactDirectory':str(base),'initialize':report.get('initialize'),'error':report.get('error'),'providerCalls':len(fixture.calls),'goalToolNames':list(fixture.schemas)},ensure_ascii=False))
sys.exit(0 if report['passed'] else 1)
