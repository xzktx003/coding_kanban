#!/usr/bin/env python3
"""Own native approval fixture; never discovers auth, IPC or a running runtime."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
GUARDS = HERE.parent / 'session-goal-native'
sys.path.insert(0, str(GUARDS))
from connect_guard import start_connect_guard

parser = argparse.ArgumentParser()
parser.add_argument('--codex', required=True)
parser.add_argument('--browser', required=True)
parser.add_argument('--output-dir', required=True)
args = parser.parse_args()
original = Path(args.codex).resolve(strict=True)
browser = Path(args.browser).resolve(strict=True)
output = Path(args.output_dir).resolve(strict=True)
base = Path(tempfile.mkdtemp(prefix='approval-', dir=output)); base.chmod(0o700)
for name in ('home', 'cli', 'app', 'tmp', 'config', 'cache', 'data', 'project', 'bin'):
    (base / name).mkdir(mode=0o700)
binary = base / 'bin' / 'codex'
shutil.copyfile(original, binary); binary.chmod(0o700)
digest = hashlib.sha256(original.read_bytes()).hexdigest()
assert hashlib.sha256(binary.read_bytes()).hexdigest() == digest
calls = []; errors = []; lock = threading.Lock()
class Provider(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        try:
            if self.path != '/v1/responses': raise RuntimeError('Unexpected provider route')
            length = int(self.headers.get('content-length', '0'))
            if not 0 < length < 16*1024*1024: raise RuntimeError('Provider size invalid')
            body = json.loads(self.rfile.read(length))
            with lock:
                index = len(calls) + 1
                calls.append({'index': index, 'authorization': bool(self.headers.get('authorization'))})
            (base / ('provider-%02d.json' % index)).write_text(json.dumps(body, indent=2))
            tools = []
            for tool in body.get('tools', []):
                if isinstance(tool.get('tools'), list):
                    tools.extend({**inner, 'namespace': tool.get('name')} for inner in tool['tools'])
                else: tools.append(tool)
            previous = [item for item in body.get('input', []) if item.get('type') == 'function_call_output']
            if not previous:
                tool = next(tool for tool in tools if tool.get('name') == 'exec_command')
                schema = tool['parameters']['properties']
                assert 'require_escalated' in schema['sandbox_permissions']['enum']
                arguments = {'cmd': 'printf APPROVAL_FIXTURE_OK', 'workdir': str(base / 'project'),
                             'sandbox_permissions': 'require_escalated', 'justification': 'Allow this fixture printf in its private temporary workspace?'}
                item = {'type': 'function_call', 'id': 'tool-%d' % index, 'call_id': 'tool-%d' % index,
                        'name': tool['name'], 'arguments': json.dumps(arguments)}
                if tool.get('namespace'): item['namespace'] = tool['namespace']
            else:
                item = {'type': 'message', 'id': 'done-%d' % index, 'role': 'assistant',
                        'content': [{'type': 'output_text', 'text': 'APPROVAL_FIXTURE_COMPLETE'}]}
            self.send_response(200); self.send_header('content-type', 'text/event-stream'); self.end_headers()
            for event in ({'type': 'response.created', 'response': {'id': 'response-%d' % index}},
                          {'type': 'response.output_item.done', 'item': item},
                          {'type': 'response.completed', 'response': {'id': 'response-%d' % index,
                           'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}}):
                self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode()); self.wfile.flush()
        except Exception as error:
            errors.append(repr(error))
            try: self.send_error(500)
            except OSError: pass

provider = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider); provider.daemon_threads = True
threading.Thread(target=provider.serve_forever, daemon=True).start()
(base / 'cli' / 'config.toml').write_text('''model="approval-fixture"
model_provider="approval_fixture"
approval_policy="on-request"
sandbox_mode="read-only"
[model_providers.approval_fixture]
name="Own deterministic approval fixture"
base_url="http://127.0.0.1:%d/v1"
wire_api="responses"
requires_openai_auth=false
request_max_retries=0
stream_max_retries=0
''' % provider.server_port)
control = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
control_name = '@approval-fixture-' + secrets.token_hex(12)
control.bind('\0' + control_name[1:]); control.listen(1); control.settimeout(20)
env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
env.update(HOME=str(base/'home'), CODEX_HOME=str(base/'cli'), SESSION_DATA_HOME=str(base/'app'),
    TMPDIR=str(base/'tmp'), XDG_CONFIG_HOME=str(base/'config'), XDG_CACHE_HOME=str(base/'cache'), XDG_DATA_HOME=str(base/'data'),
    DO_NOT_TRACK='1', OTEL_SDK_DISABLED='true', NO_PROXY='127.0.0.1', no_proxy='127.0.0.1',
    APPROVAL_PYTHON=sys.executable, APPROVAL_LAUNCHER=str(GUARDS/'runtime-native-launch.py'),
    APPROVAL_CLI=str(binary), APPROVAL_CONTROL_SOCKET=control_name, APPROVAL_OUTPUT=str(base), APPROVAL_BROWSER=str(browser))
repo = HERE.parents[2]
loader = (repo/'packages/session-runtime/node_modules/tsx/dist/loader.mjs').resolve(strict=True)
log = (base/'runner.log').open('w')
process = subprocess.Popen(['node', '--import', str(loader), str(HERE/'runner.mts')], cwd=base/'project', env=env,
    stdout=log, stderr=log, start_new_session=True)
decisions=[]; close_guard=lambda: None
try:
    connection, _ = control.accept()
    decisions, close_guard = start_connect_guard(connection, provider.server_port, base/'network-decisions.jsonl')
    connection.close()
    process.wait(timeout=180)
except Exception as error: errors.append(repr(error))
finally:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=5)
    close_guard(); control.close(); provider.shutdown(); provider.server_close(); log.close()
auth = [str(p.relative_to(base)) for p in base.rglob('*') if p.name in ('auth.json', 'accounts.json')]
if auth: errors.append('Unexpected auth files')
if any(c['authorization'] for c in calls): errors.append('Unexpected provider Authorization')
if any(d.get('allowed') and (d.get('address') != '127.0.0.1' or d.get('port') != provider.server_port) for d in decisions): errors.append('Unexpected allowed connect')
if any('guardError' in d or 'replyError' in d for d in decisions): errors.append('Network guard error')
if not any(d.get('allowed') for d in decisions): errors.append('No native provider connection')
traced = set(int(match.group(1)) for line in (base/'native.network.log').read_text().splitlines()
             if (match := re.match(r'(\d+) ', line))) if (base/'native.network.log').exists() else set()
remaining = []
for tid in traced:
    try:
        own_env = dict(item.split(b'=', 1) for item in (Path('/proc')/str(tid)/'environ').read_bytes().split(b'\0') if b'=' in item)
        if own_env.get(b'CODEX_HOME') == str(base/'cli').encode(): remaining.append(tid)
    except (FileNotFoundError, PermissionError, ProcessLookupError): pass
if remaining: errors.append('Own private native tasks remain')
result = json.loads((base/'browser-result.json').read_text()) if (base/'browser-result.json').exists() else {}
report={'passed': process.returncode == 0 and result.get('passed') is True and not errors,
        'artifactDirectory': str(base), 'cli': {'source': str(original), 'sha256': digest, 'privateCopy': str(binary)},
        'providerCalls': calls, 'networkDecisions': decisions, 'authFiles': auth, 'actualModelCalls': 0,
        'errors': errors, 'result': result, 'exitCode': process.returncode,
        'tracedNativeTids': len(traced), 'remainingOwnNativeTids': remaining,
        'fixtureSha256': {name:hashlib.sha256((HERE/name).read_bytes()).hexdigest() for name in ('acceptance.py','runner.mts','frontend.tsx')}}
(base/'summary.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'passed':report['passed'], 'artifactDirectory':str(base), 'errors':errors, 'exitCode':process.returncode}))
raise SystemExit(0 if report['passed'] else 1)
