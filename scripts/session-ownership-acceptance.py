#!/usr/bin/env python3
"""Isolated real-runtime ownership acceptance; no credentials or remote model calls.
Usage: python3 scripts/session-ownership-acceptance.py --codex /path/to/codex
Build the Rust runtime first. Only processes started here are terminated.
"""
import argparse
import datetime
import fcntl
import http.server
import json
import os
from pathlib import Path
import queue
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def wait_for(fn, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(.1)
    raise AssertionError('condition did not converge')


def locked(path):
    if not path.exists():
        return False
    with path.open('rb') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        return False


class Native:
    def __init__(self, binary, env, log):
        self.process = subprocess.Popen([binary, 'app-server', '-c', 'thread_unload_delay_secs=2'],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True, env=env, start_new_session=True)
        self.messages = queue.Queue()
        self.sequence = 0
        def reader():
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
        threading.Thread(target=reader, daemon=True).start()
        assert 'result' in self.call('initialize', {'clientInfo': {'name': 'ownership_acceptance', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
    def call(self, method, params):
        self.sequence += 1
        self.process.stdin.write(json.dumps({'id': self.sequence, 'method': method, 'params': params}) + '\n')
        self.process.stdin.flush()
        while True:
            response = self.messages.get(timeout=30)
            if response.get('id') == self.sequence:
                return response


def stop(process):
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex', required=True)
    parser.add_argument('--runtime', default=str(ROOT / 'packages/session-runtime/target/debug/codexia-web'))
    parser.add_argument('--output')
    args = parser.parse_args()
    model_calls = []
    class Model(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('content-length', 0)))
            model_calls.append(body)
            rid = 'acceptance-' + str(len(model_calls))
            events = [
                {'type': 'response.created', 'response': {'id': rid}},
                {'type': 'response.output_item.done', 'item': {'type': 'message', 'role': 'assistant', 'id': rid + '-message', 'content': [{'type': 'output_text', 'text': 'Ownership acceptance OK'}]}},
                {'type': 'response.completed', 'response': {'id': rid, 'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}},
            ]
            self.send_response(200)
            self.send_header('content-type', 'text/event-stream')
            self.end_headers()
            for event in events:
                self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
            self.wfile.flush()
    model = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    runtime = other = None
    quit_heartbeat = threading.Event()
    try:
        with tempfile.TemporaryDirectory(prefix='kanban-ownership-') as directory:
            base = Path(directory)
            cli = base / 'cli'; cli.mkdir()
            (cli / 'config.toml').write_text(f'''model = "acceptance-model"
model_provider = "acceptance"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.acceptance]
name = "local acceptance fixture"
base_url = "http://127.0.0.1:{model.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
''')
            tid = str(uuid.uuid4())
            stamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
            history_dir = cli / 'sessions' / '2026' / '10' / '08'; history_dir.mkdir(parents=True)
            history = history_dir / f'rollout-2026-10-08T00-00-00-{tid}.jsonl'
            records = [
                {'type': 'session_meta', 'payload': {'id': tid, 'session_id': tid, 'timestamp': stamp, 'cwd': directory, 'originator': 'codex_cli_rs', 'cli_version': '0.159.2', 'source': 'cli', 'model_provider': 'acceptance', 'history_mode': 'legacy'}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'Original preserved history'}]}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'Original answer'}]}},
            ]
            records.insert(1, {'type':'event_msg','payload':{'type':'task_started','turn_id':'original-turn','model_context_window':None,'collaboration_mode_kind':'default'}})
            records.insert(3, {'type':'event_msg','payload':{'type':'user_message','message':'Original preserved history','images':[],'local_images':[],'text_elements':[]}})
            records.append({'type':'event_msg','payload':{'type':'agent_message','message':'Original answer'}})
            records.append({'type':'event_msg','payload':{'type':'task_complete','turn_id':'original-turn','last_agent_message':'Original answer'}})
            history.write_text(''.join(json.dumps(dict(timestamp=stamp, **r)) + '\n' for r in records))
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            env = dict(os.environ, CODEX_HOME=str(cli), CODEX_PATH=args.codex, SESSION_DATA_HOME=str(base / 'app'), CLAUDE_CONFIG_DIR=str(base / 'claude'), CODEXIA_NO_BROWSER='1', SESSION_RUNTIME_INSTANCE=str(uuid.uuid4()))
            def api(path, params=None):
                req = urllib.request.Request(f'http://127.0.0.1:{port}' + path,
                      data=None if params is None else json.dumps(params).encode(), headers={'content-type': 'application/json'})
                try:
                    with urllib.request.urlopen(req, timeout=40) as response:
                        return response.status, json.load(response)
                except urllib.error.HTTPError as error:
                    return error.code, json.load(error)
            def ready():
                try:
                    status, health = api('/health')
                    if status != 200 or health.get('instance') != env['SESSION_RUNTIME_INSTANCE']:
                        return False
                    return api('/api/codex/thread/list', {'limit': 1})[0] == 200
                except (OSError, ValueError):
                    return False
            with (base / 'runtime.log').open('w') as log, (base / 'other.log').open('w') as other_log:
                runtime = subprocess.Popen([args.runtime, '--port', str(port)], env=env, stdout=log, stderr=log, start_new_session=True)
                try:
                    wait_for(ready, 30)
                    def heartbeat():
                        while not quit_heartbeat.is_set():
                            try:
                                api('/api/internal/codex/queue-holds', {'busy': False, 'threadIds': [], 'sequence': str(time.monotonic_ns())})
                            except OSError:
                                pass
                            quit_heartbeat.wait(1)
                    threading.Thread(target=heartbeat, daemon=True).start()
                    lock = cli / 'thread-writer-locks' / (tid + '.lock')
                    status, result = api('/api/codex/thread/read', {'threadId': tid})
                    assert status == 200 and result['thread']['id'] == tid, (status, result)
                    assert not locked(lock), 'viewing history acquired a writer'
                    # A separate real app-server acts as CLI/IDE owner of this same ID.
                    other = Native(args.codex, env, other_log)
                    assert 'result' in other.call('thread/resume', {'threadId': tid})
                    assert locked(lock)
                    assert api('/api/codex/thread/read', {'threadId': tid})[0] == 200
                    start = {'threadId': tid, 'input': [{'type': 'text', 'text': 'Acceptance message', 'text_elements': []}], 'clientUserMessageId': str(uuid.uuid4())}
                    status, error = api('/api/codex/turn/start', start)
                    assert status == 409 and error['error'].startswith('SESSION_OWNED_ELSEWHERE'), (status, error)
                    assert len(model_calls) == 0, 'external ownership caused a model call'
                    assert 'result' in other.call('thread/unsubscribe', {'threadId': tid})
                    wait_for(lambda: not locked(lock))
                    status, accepted = api('/api/codex/turn/start', start)
                    assert status == 200 and accepted['turn']['id'], (status, accepted)
                    wait_for(lambda: len(model_calls) == 1)
                    wait_for(lambda: not locked(lock))
                    wait_for(lambda: api('/api/codex/thread/access', {'threadId': tid})[1]['state'] == 'readonly')
                    status, restored = api('/api/codex/thread/read', {'threadId': tid})
                    assert status == 200 and restored['thread']['id'] == tid
                    assert 'Ownership acceptance OK' in json.dumps(restored), restored
                    assert 'Original preserved history' in json.dumps(restored), restored
                    # Explicit acquire/release with a concurrent new send must await actual unload.
                    assert api('/api/codex/thread/resume', {'threadId': tid})[0] == 200
                    status, releasing = api('/api/codex/thread/access', {'threadId': tid, 'release': True})
                    assert status == 200 and releasing['state'] in ('owned', 'releasing'), releasing
                    if releasing['state'] == 'owned':
                        releasing = wait_for(lambda: (r if (r := api('/api/codex/thread/access', {'threadId': tid, 'release': True})[1])['state'] == 'releasing' else False))
                    assert locked(lock), 'unsubscribe falsely treated as immediate release'
                    status, accepted2 = api('/api/codex/turn/start', dict(start, clientUserMessageId=str(uuid.uuid4())))
                    assert status == 200 and accepted2['turn']['id'] != accepted['turn']['id'], (status, accepted2)
                    wait_for(lambda: not locked(lock))
                    assert len(model_calls) == 2, 'mutation was lost or repeated'
                    assert other.call('thread/resume', {'threadId': tid})['result']['thread']['id'] == tid
                    assert api('/api/codex/thread/read', {'threadId': tid})[0] == 200
                    # Exercise the native paginated contract, not just a mocked turns list.
                    status, created = api('/api/codex/thread/start', {'cwd': directory, 'historyMode':'paginated'})
                    assert status == 200 and created['thread']['historyMode'] == 'paginated', (status, created)
                    paginated_id = created['thread']['id']
                    # A user can wait while composing the first message. Sweeps
                    # must keep the unmaterialized thread loaded in that time.
                    time.sleep(3)
                    assert paginated_id in api('/api/codex/thread/loaded/list', {'limit': 100})[1]['data']
                    status, empty_history = api('/api/codex/thread/read', {'threadId': paginated_id})
                    assert status == 200 and empty_history['thread']['turns'] == [], (status, empty_history)
                    status, paginated_turn = api('/api/codex/turn/start', dict(start,threadId=paginated_id,clientUserMessageId=str(uuid.uuid4())))
                    assert status == 200, (status,paginated_turn)
                    paginated_lock = cli / 'thread-writer-locks' / (paginated_id + '.lock')
                    wait_for(lambda: len(model_calls) == 3)
                    wait_for(lambda: not locked(paginated_lock))
                    status, paginated_history = api('/api/codex/thread/read', {'threadId':paginated_id})
                    assert status == 200 and 'Ownership acceptance OK' in json.dumps(paginated_history), (status,paginated_history)
                    assert other.call('thread/resume', {'threadId':paginated_id})['result']['thread']['id'] == paginated_id
                    assert api('/api/codex/thread/read', {'threadId':paginated_id})[0] == 200
                    report = {'passed': True, 'sameThreadId': tid, 'independentNativeProcesses': 2, 'localModelCalls': len(model_calls), 'remoteModelCalls': 0, 'readOnlyWhileExternalOwner': True, 'conflictBeforeDispatch': True, 'automaticReleaseConfirmedByKernelLock': True, 'releaseSendRace': True, 'originalHistoryPreserved': True, 'nativePaginatedHistoryReadWhileExternallyOwned': True, 'emptyThreadSurvivesSweepAndFirstSend': True}
                    print(json.dumps(report, ensure_ascii=False, indent=2))
                    if args.output:
                        Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2))
                except Exception:
                    log.flush()
                    print((base / 'runtime.log').read_text()[-12000:])
                    raise
                finally:
                    quit_heartbeat.set()
                    stop(other.process if other else None)
                    stop(runtime)
    finally:
        quit_heartbeat.set()
        stop(other.process if other else None)
        stop(runtime)
        model.shutdown()


if __name__ == '__main__':
    main()
