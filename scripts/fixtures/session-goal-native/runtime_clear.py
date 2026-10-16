#!/usr/bin/env python3
"""Run product Ownership+StdioRpc against private native and loopback SSE."""
import argparse
import hashlib
import http.server
import json
import os
import secrets
import re
import signal
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from connect_guard import start_connect_guard

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(); parser.add_argument("--cli", required=True); parser.add_argument("--output-dir", required=True)
args = parser.parse_args(); binary = Path(args.cli).resolve(strict=True)
base = Path(tempfile.mkdtemp(prefix="runtime-", dir=Path(args.output_dir).resolve(strict=True))); base.chmod(0o700)
for name in ("home", "cli", "tmp", "config", "cache", "data", "project"):
    (base/name).mkdir(mode=0o700)
provider_calls=[]; errors=[]; released=threading.Event(); schemas={}
ledger=(base/'timeline.jsonl').open('w',buffering=1); ledger_lock=threading.Lock()
def record(kind, **payload):
    with ledger_lock: ledger.write(json.dumps({'monotonicSeconds':round(time.monotonic(),6),'kind':kind,**payload})+'\n')
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*_): pass
    def do_POST(self):
        try:
            if self.path!='/v1/responses': raise RuntimeError('Unexpected provider path')
            length=int(self.headers.get('content-length','0'))
            if length>16*1024*1024: raise RuntimeError('Oversized provider request')
            body=json.loads(self.rfile.read(length)); index=len(provider_calls)+1
            (base/('provider-request-%02d.json'%index)).write_text(json.dumps(body,indent=2)+'\n')
            tools=[]
            for tool in body.get('tools',[]):
                if isinstance(tool.get('tools'),list): tools.extend({**inner,'namespace':tool.get('name')} for inner in tool['tools'])
                else: tools.append(tool)
            goals=[tool for tool in tools if 'goal' in tool.get('name','')]
            for tool in goals: schemas[tool['name']]=tool
            provider_calls.append({'index':index,'authorizationHeaderPresent':bool(self.headers.get('authorization'))})
            record('provider.request',index=index)
            if index==1 and not released.wait(12): raise TimeoutError('Runtime did not activate goal')
            rid='runtime-offline-%d'%index
            self.send_response(200);self.send_header('content-type','text/event-stream');self.end_headers()
            def send(value):
                record('provider.event',event=value); self.wfile.write(('data: '+json.dumps(value)+'\n\n').encode());self.wfile.flush()
            send({'type':'response.created','response':{'id':rid}})
            if index==2:
                goal=next(tool for tool in goals if tool.get('name')=='update_goal')
                assert goal['parameters']['required']==['status'] and 'complete' in goal['parameters']['properties']['status']['enum']
                item={'type':'function_call','id':rid+'-complete','call_id':rid+'-complete','name':'update_goal','arguments':json.dumps({'status':'complete'})}
                if goal.get('namespace'): item['namespace']=goal['namespace']
            else: item={'type':'message','id':rid+'-message','role':'assistant','content':[{'type':'output_text','text':'OFFLINE_RUNTIME_DONE'}]}
            send({'type':'response.output_item.done','item':item})
            send({'type':'response.completed','response':{'id':rid,'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}})
        except Exception as error: errors.append(repr(error));record('provider.error',error=repr(error))
provider=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);provider.daemon_threads=True
threading.Thread(target=provider.serve_forever,daemon=True).start()
(base/'cli'/'config.toml').write_text('''model="goal-offline-fixture"
model_provider="goal_offline"
approval_policy="never"
sandbox_mode="read-only"
[features]
goals=true
[model_providers.goal_offline]
name="Private deterministic runtime Goal SSE"
base_url="http://127.0.0.1:%d/v1"
wire_api="responses"
requires_openai_auth=false
request_max_retries=0
stream_max_retries=0
''' % provider.server_port)
control=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
control_path='@goal-runtime-clear-'+secrets.token_hex(12);control.bind('\0'+control_path[1:]);control.listen(1);control.settimeout(15)
env={key:os.environ[key] for key in ('PATH','LANG','LC_ALL') if key in os.environ}
env.update(HOME=str(base/'home'),CODEX_HOME=str(base/'cli'),TMPDIR=str(base/'tmp'),XDG_CONFIG_HOME=str(base/'config'),XDG_CACHE_HOME=str(base/'cache'),XDG_DATA_HOME=str(base/'data'),
    DO_NOT_TRACK='1',OTEL_SDK_DISABLED='true',NO_PROXY='127.0.0.1',no_proxy='127.0.0.1',
    GOAL_PYTHON=sys.executable,GOAL_NATIVE_LAUNCHER=str(HERE/'runtime-native-launch.py'),GOAL_NATIVE_CLI=str(binary),GOAL_CONTROL_SOCKET=str(control_path),GOAL_NETWORK_TRACE=str(base/'native.network.log'),GOAL_PROJECT=str(base/'project'))
repo=HERE.parents[2]; loader=(repo/'packages/session-runtime/node_modules/tsx/dist/loader.mjs').resolve(strict=True)
source_hashes={name:hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in ('packages/session-runtime/src/codex/ownership.ts','packages/session-runtime/src/codex/goal-state.ts','packages/session-runtime/src/codex/protocol.ts','packages/session-runtime/src/transport/rpc.ts')}
stderr=(base/'runtime.stderr.log').open('w')
process=subprocess.Popen(['node','--import',str(loader),str(HERE/'runtime-clear-runner.mts')],cwd=base/'project',env=env,stdout=subprocess.PIPE,stderr=stderr,text=True,start_new_session=True)
results=[]; decisions=[]; close_guard=lambda:None
def consume():
    for line in process.stdout:
        value=json.loads(line);results.append(value);record('runtime',entry=value)
        if value.get('kind')=='fixture.release-first-response': released.set()
threading.Thread(target=consume,daemon=True).start()
try:
    connection,_=control.accept(); decisions,close_guard=start_connect_guard(connection,provider.server_port,base/'network-decisions.jsonl');connection.close()
    process.wait(timeout=30)
except Exception as error:
    errors.append(repr(error))
finally:
    if process.poll() is None:
        os.killpg(process.pid,signal.SIGTERM)
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
    released.set();close_guard();control.close();provider.shutdown();provider.server_close();stderr.close()
    time.sleep(.1)
audit=[]
if errors:audit.extend(errors)
if any(call['authorizationHeaderPresent'] for call in provider_calls):audit.append('Authorization header found')
auth_files=[str(path.relative_to(base)) for path in base.rglob('*') if path.is_file() and path.name in ('auth.json','accounts.json')]
if auth_files:audit.append('Auth files created')
if any(decision.get('allowed') and (decision.get('address')!='127.0.0.1' or decision.get('port')!=provider.server_port) for decision in decisions):audit.append('Unexpected allowed connect')
if any('guardError' in decision or 'replyError' in decision for decision in decisions):audit.append('Connect guard error')
if not any(decision.get('allowed') for decision in decisions):audit.append('No own-loopback provider connection')
traced_tids=set(int(match.group(1)) for line in (base/'native.network.log').read_text().splitlines() if (match:=re.match(r'(\d+) ',line))) if (base/'native.network.log').exists() else set()
remaining=[]
for tid in traced_tids:
    try:
        own_env=dict(item.split(b'=',1) for item in (Path('/proc')/str(tid)/'environ').read_bytes().split(b'\0') if b'=' in item)
        if own_env.get(b'CODEX_HOME')==str(base/'cli').encode():remaining.append(tid)
    except (FileNotFoundError,PermissionError,ProcessLookupError): pass
if remaining:audit.append('Own private native process remains')
result=next((value for value in results if value.get('kind')=='result'),{})
report={'passed':process.returncode==0 and result.get('passed') is True and not audit,'artifactDirectory':str(base),'binary':{'path':str(binary),'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()},'productSourceSha256':source_hashes,'runtimeResult':result,
    'isolation':{'privateHome':str(base/'home'),'privateCodexHome':str(base/'cli'),'authCopied':False,'authFilesCreated':auth_files,'actualModelCalls':0,'providerPort':provider.server_port,'providerCalls':provider_calls,'connectDecisions':decisions,'ownProcessExited':process.poll() is not None,'tracedNativeTids':len(traced_tids),'remainingOwnNativeTids':remaining,'auditErrors':audit},'goalTools':schemas}
(base/'result.json').write_text(json.dumps(report,indent=2)+'\n')
ledger.close();print(json.dumps({'passed':report['passed'],'artifactDirectory':str(base),'runtimeResult':result,'auditErrors':audit}))
raise SystemExit(0 if report['passed'] else 1)
