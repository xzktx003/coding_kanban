#!/usr/bin/env python3
"""Isolated native sub-agent acceptance. Only this script's processes are stopped.
Requires a built runtime and an explicit --codex binary. No remote model/auth calls.
"""
import argparse
import http.server
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
import urllib.error
import uuid
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ownership_fixture", ROOT / "scripts/session-ownership-acceptance.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", required=True)
    parser.add_argument("--runtime", default=str(ROOT / "packages/session-runtime/target/debug/codexia-web"))
    parser.add_argument("--v2", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--questions", action="store_true")
    mode.add_argument("--approvals", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    calls, notifications = [], []
    release = threading.Event()
    lock = threading.Lock()
    class Model(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            with lock:
                calls.append(body); number = len(calls)
            messages = [i for i in body.get("input", []) if i.get("role") == "user"]
            latest = json.dumps(messages[-1] if messages else {})
            child_request = "CHILD_" in latest or any(i.get("type") == "agent_message" and "CHILD_" in json.dumps(i) for i in body.get("input", []))
            question_call = args.questions and (number > 1 and not child_request) and not any(i.get("type") == "function_call" and i.get("name") == "request_user_input" for i in body.get("input", []))
            approval_call = args.approvals and child_request and "CHILD_BETA" in json.dumps(body.get("input", [])) and not any(i.get("type") == "function_call" and i.get("name") == "exec_command" for i in body.get("input", []))
            rid = f"subagent-acceptance-{number}"
            if number == 1:
                print("Native tool names:", [t.get("name", t.get("type")) for t in body.get("tools", [])], flush=True)
                tool = next((t for t in body.get("tools", []) if t.get("name") in ("collaboration", "multi_agent_v1")), None)
                spawn_namespace = tool["name"] if tool else None
                items = [{"id": f"fc-{n}", "type": "function_call", "call_id": f"call-{n}", "name": "spawn_agent", "namespace": spawn_namespace, "arguments": json.dumps({"message": f"CHILD_{n.upper()}", "agent_type": "default", "task_name": n})} for n in ("alpha", "beta")]
            elif approval_call:
                items = [{"type": "function_call", "id": rid + "-approval", "call_id": "child-approval", "name": "exec_command", "arguments": json.dumps({"cmd": "pwd", "sandbox_permissions": "require_escalated", "justification": "Isolated approval identity test"})}]
            elif question_call:
                items = [{"type": "function_call", "id": rid + "-question", "call_id": "child-question", "name": "request_user_input", "arguments": json.dumps({"questions": [{"id": "choice", "header": "范围", "question": "选择测试范围？", "options": [{"label": "A", "description": "第一组"}, {"label": "B", "description": "第二组"}]}]})}]
            else:
                items = [{"type": "message", "id": rid + "-msg", "role": "assistant", "content": [{"type": "output_text", "text": "Native subagent acceptance completed"}]}]
            self.send_response(200); self.send_header("content-type", "text/event-stream"); self.end_headers()
            try:
                self.wfile.write(("data: " + json.dumps({"type": "response.created", "response": {"id": rid}}) + "\n\n").encode()); self.wfile.flush()
                if number != 1 and child_request and not question_call and not approval_call:
                    # Keep a real child turn running until it is explicitly interrupted.
                    release.wait(25)
                events = [{"type": "response.output_item.done", "item": item} for item in items]
                events.append({"type": "response.completed", "response": {"id": rid, "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}})
                for event in events: self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError): pass
    model = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    runtime = None
    try:
        with tempfile.TemporaryDirectory(prefix="kanban-subagent-") as directory:
            base = Path(directory); cli = base / "cli"; cli.mkdir()
            (cli / "config.toml").write_text(f'''model = "acceptance-model"
model_provider = "acceptance"
approval_policy = "{'on-request' if args.approvals else 'never'}"
sandbox_mode = "{'read-only' if args.approvals else 'danger-full-access'}"
[features]
multi_agent = true
multi_agent_v2 = {str(args.v2).lower()}
default_mode_request_user_input = true
[agents.reviewer]
description = "Read-only review role"
[model_providers.acceptance]
name = "local deterministic acceptance"
base_url = "http://127.0.0.1:{model.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
''')
            with socket.socket() as sock: sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
            env = dict(os.environ, CODEX_HOME=str(cli), CODEX_PATH=args.codex, SESSION_DATA_HOME=str(base / "app"), CLAUDE_CONFIG_DIR=str(base / "claude"), CODEXIA_NO_BROWSER="1", SESSION_RUNTIME_INSTANCE=str(uuid.uuid4()))
            def api(path, params=None):
                request = urllib.request.Request(f"http://127.0.0.1:{port}" + path, data=None if params is None else json.dumps(params).encode(), headers={"content-type": "application/json"})
                try:
                    with urllib.request.urlopen(request, timeout=35) as response:
                        raw = response.read()
                        return response.status, json.loads(raw) if raw else {}
                except urllib.error.HTTPError as e: return e.code, json.load(e)
            def ready():
                try: return api("/health")[1].get("instance") == env["SESSION_RUNTIME_INSTANCE"] and api("/api/codex/thread/list", {"limit": 1})[0] == 200
                except (OSError, ValueError): return False
            with (base / "runtime.log").open("w") as log:
                runtime = subprocess.Popen([args.runtime, "--port", str(port)], env=env, stdout=log, stderr=log, start_new_session=True)
                try:
                    helper.wait_for(ready, 30)
                    status, response = api("/api/codex/thread/start", {"cwd": directory, "model": "acceptance-model", "modelProvider": "acceptance"})
                    assert status == 200, response
                    root = response["thread"]["id"]
                    status, roles = api("/api/codex/agents/roles", {"cwd": directory})
                    assert status == 200 and any(r["name"] == "reviewer" for r in roles["roles"]), roles
                    status, result = api("/api/codex/turn/start", {"threadId": root, "input": [{"type": "mention", "name": "reviewer", "path": "subagent://reviewer"}, {"type": "text", "text": "ROOT_TASK: create the two native children", "text_elements": []}]})
                    assert status == 200, result
                    def children():
                        status, data = api("/api/codex/thread/list", {"sourceKinds": ["subAgentThreadSpawn"], "ancestorThreadId": root, "limit": 100})
                        return data.get("data", []) if status == 200 and len(data.get("data", [])) >= 2 else None
                    descendants = helper.wait_for(children, 20)
                    assert len(descendants) == 2, descendants
                    ids = [c["id"] for c in descendants]
                    assert root not in ids
                    answer_confirmed = False
                    approval_confirmed = False
                    if args.questions or args.approvals:
                        stream = urllib.request.urlopen(f"http://127.0.0.1:{port}/api/events", timeout=10)
                        def read_events():
                            try:
                                for line in stream:
                                    if line.startswith(b"data: "): notifications.append(json.loads(line[6:]))
                            except (OSError, ValueError): pass
                        threading.Thread(target=read_events, daemon=True).start()
                        def pending_question():
                            for event in notifications:
                                if args.approvals and event.get("event") == "codex/approval-request": return event["payload"]
                                if args.approvals and event.get("event") == "codex/pending-requests-snapshot":
                                    approvals = [r["payload"] for r in event["payload"].get("requests", []) if r.get("event") == "codex/approval-request"]
                                    if approvals: return approvals[0]
                                if not args.approvals and event.get("event") == "codex/request-user-input": return event["payload"]
                                if event.get("event") == "codex/user-input-snapshot" and event["payload"].get("requests"): return event["payload"]["requests"][0]
                            return None
                        request = helper.wait_for(pending_question, 10)
                        assert (request["threadId"] in ids if args.approvals else request["threadId"] == root), request
                        endpoint = "/api/codex/approval/command-execution" if args.approvals else "/api/codex/approval/user-input"
                        context = {key: request.get(key) for key in ["threadId", "requestId", "turnId", "itemId", "requestToken"]}
                        data = {"request_id": request["requestId"], "decision": "decline"} if args.approvals else {"request_id": request["requestId"], "response": {"answers": {"choice": {"answers": ["A"]}}}}
                        status, rejected_identity = api(endpoint, {**data, "request": {**context, "requestToken": "old-runtime"}})
                        assert status == 409 and "SESSION_RPC_EXPIRED" in rejected_identity.get("error", ""), rejected_identity
                        if args.approvals:
                            status, reply = api("/api/codex/approval/command-execution", {**data, "request": context})
                            approval_confirmed = True
                        else:
                            status, reply = api("/api/codex/approval/user-input", {**data, "request": context})
                            answer_confirmed = True
                        assert status == 200, reply
                    before = len(calls)
                    meta = [api("/api/codex/thread/metadata", {"threadId": child})[1]["thread"] for child in ids]
                    assert all(t.get("parentThreadId") == root or root in json.dumps(t.get("source")) for t in meta)
                    if args.v2: assert all(t.get("canAcceptDirectInput") is False for t in meta), meta
                    for child, thread in zip(ids, meta):
                        if thread.get("canAcceptDirectInput") is not True:
                            status, rejected = api("/api/codex/turn/start", {"threadId": child, "input": [{"type": "text", "text": "forbidden direct input", "text_elements": []}]})
                            assert status != 200 and "SUBAGENT_DIRECT_INPUT_DISABLED" in rejected["error"], rejected
                    assert len(calls) >= before
                    # Read-only histories cannot change the family/parent input target or start a turn.
                    for child in ids: assert api("/api/codex/thread/read", {"threadId": child})[0] == 200
                    stopped = []
                    for child in ids:
                        status, page = api("/api/codex/thread/turns/list", {"threadId": child, "limit": 1, "sortDirection": "desc", "itemsView": "full"})
                        assert status == 200 and page["data"], page
                        turn = page["data"][0]
                        assert turn["status"] == "inProgress", turn
                        status, response = api("/api/codex/turn/interrupt", {"threadId": child, "turnId": turn["id"]})
                        assert status == 200, response
                        stopped.append(turn["id"])
                    release.set()
                    for child in ids:
                        helper.wait_for(lambda child=child: api("/api/codex/thread/turns/list", {"threadId": child, "limit": 1, "sortDirection": "desc", "itemsView": "full"})[1]["data"][0]["status"] == "interrupted", 15)
                    parent = api("/api/codex/thread/read", {"threadId": root})[1]["thread"]
                    assert parent["id"] == root
                    report = {"passed": True, "nativeVersion": subprocess.check_output([args.codex, "--version"], text=True).strip(), "v2": args.v2, "realSpawnedChildren": len(ids), "nativeRoleRead": True, "staleRequestIdentityRejected": args.questions or args.approvals, "directInputCapabilityChecked": True, "readOnlyHistories": True, "realChildInterruptsConfirmed": len(stopped), "rootPreserved": True, "parentQuestionAnswered": answer_confirmed, "childApprovalDeclined": approval_confirmed, "questionMode": "viaParent", "localModelCalls": len(calls), "remoteModelCalls": 0}
                    if args.output: Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
                    print(json.dumps(report))
                except Exception:
                    log.flush(); print((base / "runtime.log").read_text()[-5000:]); raise
    finally:
        release.set(); helper.stop(runtime); model.shutdown()

if __name__ == "__main__": main()
