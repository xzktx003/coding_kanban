#!/usr/bin/env python3
"""Raw native parent-only release gate; no credentials, IPC reuse, or remote model.

Usage: python3 scripts/session-subagent-release-acceptance.py --codex /absolute/bin/codex \
    --output-dir .dev-runtime/subagent-identity-release/native/npm

Run separately for the application's native binary and the unmodified VSIX binary.
Each run owns a new HOME, CODEX_HOME, provider, and stdio app-server processes.
This tests native compatibility. Runtime family resource protection is validated by
the Ownership tests; this script never treats raw unsubscribe as a safe policy.
"""
import argparse
import fcntl
import hashlib
import http.server
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import threading
import time
import uuid


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def wait_for(predicate, description, seconds=25):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(f"Timeout waiting for {description}")


def writer_locked(path):
    if not path.exists():
        return False
    with path.open("rb") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(stream, fcntl.LOCK_UN)
        return False


def stop_owned(process):
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


def isolated_environment(base):
    # An allowlist keeps login credentials, proxies and native IPC endpoints out.
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL") if key in os.environ}
    for name in ("home", "cli", "tmp", "app", "config", "cache", "data"):
        (base / name).mkdir()
    env.update(HOME=str(base / "home"), CODEX_HOME=str(base / "cli"),
               SESSION_DATA_HOME=str(base / "app"), TMPDIR=str(base / "tmp"),
               XDG_CONFIG_HOME=str(base / "config"), XDG_CACHE_HOME=str(base / "cache"),
               XDG_DATA_HOME=str(base / "data"), DO_NOT_TRACK="1", CODEXIA_NO_BROWSER="1",
               NO_PROXY="127.0.0.1,localhost,::1", no_proxy="127.0.0.1,localhost,::1")
    return env


class Native:
    def __init__(self, binary, env, directory, label):
        self.log = (directory / f"{label}.stderr.log").open("w")
        self.process = subprocess.Popen(
            [str(binary), "app-server", "-c", "thread_unload_delay_secs=2"],
            cwd=directory, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self.log, text=True, start_new_session=True)
        self.condition = threading.Condition()
        self.messages, self.responses, self.sequence = [], {}, 0
        self.reader_error = None

        def read():
            try:
                for line in self.process.stdout:
                    message = json.loads(line)
                    with self.condition:
                        self.messages.append(message)
                        if "id" in message and "method" not in message:
                            self.responses[message["id"]] = message
                        self.condition.notify_all()
            except Exception as error:
                self.reader_error = repr(error)
            finally:
                with self.condition:
                    self.condition.notify_all()

        threading.Thread(target=read, daemon=True).start()
        try:
            self.initialized = self.call("initialize", {
                "clientInfo": {"name": "subagent_release_acceptance", "version": "1"},
                "capabilities": {"experimentalApi": True}})
            self.notify("initialized", {})
        except Exception:
            self.close()
            raise

    def notify(self, method, params):
        self.process.stdin.write(json.dumps({"method": method, "params": params}) + "\n")
        self.process.stdin.flush()

    def reply(self, request_id, result):
        self.process.stdin.write(json.dumps({"id": request_id, "result": result}) + "\n")
        self.process.stdin.flush()

    def call(self, method, params, timeout=30):
        self.sequence += 1
        sequence = self.sequence
        self.process.stdin.write(json.dumps({"id": sequence, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        end = time.monotonic() + timeout
        with self.condition:
            while sequence not in self.responses:
                require(self.process.poll() is None, f"Native exited during {method}: {self.reader_error}")
                left = end - time.monotonic()
                require(left > 0, f"Native response timeout: {method}")
                self.condition.wait(min(left, 0.25))
            response = self.responses.pop(sequence)
        require("result" in response, f"{method} failed: {response.get('error')}")
        return response["result"]

    def events(self, method):
        with self.condition:
            return [item for item in self.messages if item.get("method") == method]

    def loaded(self):
        result, ids, cursor = {}, set(), None
        while True:
            result = self.call("thread/loaded/list", {"limit": 100, "cursor": cursor})
            ids.update(result["data"])
            cursor = result.get("nextCursor")
            if cursor is None:
                return ids

    def thread(self, thread_id, turns=False):
        return self.call("thread/read", {"threadId": thread_id, "includeTurns": turns})["thread"]

    def close(self):
        stop_owned(self.process)
        self.log.close()


class Fixture:
    def __init__(self):
        self.calls, self.lock = [], threading.Lock()
        self.spawn_namespace = None
        self.active_child_started, self.active_child_release = threading.Event(), threading.Event()
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                require(self.path.endswith("/responses"), f"Unexpected fixture route: {self.path}")
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
                user = [item for item in body.get("input", []) if item.get("role") == "user"]
                latest = json.dumps(user[-1] if user else {})
                agent_messages = [item for item in body.get("input", []) if item.get("type") == "agent_message"]
                routed_input = json.dumps(agent_messages[-1]) if agent_messages else latest
                child = "CHILD_RELEASE_" in routed_input
                active = "RELEASE_ACTIVE" in routed_input
                with fixture.lock:
                    fixture.calls.append({"sequence": len(fixture.calls) + 1,
                                          "child": child, "active": active,
                                          "remote": False, "path": self.path,
                                          "latestInputTypes": [item.get("type") for item in body.get("input", [])[-6:]],
                                          "toolNames": [tool.get("name", tool.get("type")) for tool in body.get("tools", [])],
                                          "toolResults": [str(item.get("output", ""))[-1400:] for item in body.get("input", [])
                                                          if item.get("type") == "function_call_output"][-2:],
                                          "latestFixtureInput": routed_input[-700:]})
                    number = len(fixture.calls)
                rid = f"release-fixture-{number}"
                previous_spawn = any(item.get("type") == "function_call" and item.get("name") == "spawn_agent"
                                     for item in body.get("input", []))
                if not child and "ROOT_RELEASE_" in latest and not previous_spawn:
                    tools = body.get("tools", [])
                    plain_spawn = any(tool.get("name") == "spawn_agent" for tool in tools)
                    namespace = None if plain_spawn else next((tool.get("name") for tool in tools
                                      if tool.get("name") in ("collaboration", "multi_agent_v1")), None)
                    fixture.spawn_namespace = namespace
                    kind = "APPROVAL" if "RELEASE_APPROVAL" in latest else "ACTIVE" if active else "IDLE"
                    item = {"type": "function_call", "id": rid + "-spawn", "call_id": rid + "-spawn",
                            "name": "spawn_agent", "arguments": json.dumps({
                                "message": f"CHILD_RELEASE_{kind}", "task_name": "release_child",
                                "agent_type": "default"})}
                    if namespace is not None:
                        item["namespace"] = namespace
                elif child and "CHILD_RELEASE_APPROVAL" in routed_input and not any(
                        entry.get("type") == "function_call" and entry.get("name") == "exec_command"
                        for entry in body.get("input", [])):
                    item = {"type": "function_call", "id": rid + "-approval", "call_id": rid + "-approval",
                            "name": "exec_command", "arguments": json.dumps({
                                "cmd": "pwd", "sandbox_permissions": "require_escalated",
                                "justification": "Isolated child approval metadata fixture"})}
                elif not child and "ROOT_RESUME_EXERCISE" in latest and not any(
                        item.get("type") == "function_call" and item.get("name") == "followup_task"
                        for item in body.get("input", [])):
                    item = {"type": "function_call", "id": rid + "-followup", "call_id": rid + "-followup",
                            "name": "followup_task", "arguments": json.dumps({
                                "target": "/root/release_child", "message": "CHILD_RELEASE_RESTORED"})}
                    namespace = next((tool.get("name") for tool in body.get("tools", [])
                                      if any(t.get("name") == "followup_task" for t in tool.get("tools", []))), None)
                    if namespace is not None:
                        item["namespace"] = namespace
                elif "ROOT_PENDING_EXERCISE" in latest and not any(
                        entry.get("type") == "function_call" and entry.get("name") == "request_user_input"
                        for entry in body.get("input", [])):
                    item = {"type": "function_call", "id": rid + "-question", "call_id": rid + "-question",
                            "name": "request_user_input", "arguments": json.dumps({"questions": [{
                                "id": "release_choice", "header": "Fixture", "question": "Choose fixture state",
                                "options": [{"label": "Keep", "description": "Keep isolated fixture"},
                                            {"label": "Complete", "description": "Complete isolated fixture"}]}]})}
                elif "ROOT_BACKGROUND_EXERCISE" in latest and not any(
                        entry.get("type") == "function_call" and entry.get("name") == "exec_command"
                        for entry in body.get("input", [])):
                    item = {"type": "function_call", "id": rid + "-background", "call_id": rid + "-background",
                            "name": "exec_command", "arguments": json.dumps({
                                "cmd": "sleep 15", "yield_time_ms": 1, "max_output_tokens": 64})}
                else:
                    text = ("CHILD_RESTORED_HISTORY_RELEASE_OK" if "CHILD_RELEASE_RESTORED" in routed_input
                            else "CHILD_HISTORY_RELEASE_OK" if child else "ROOT_HISTORY_RELEASE_OK")
                    item = {"type": "message", "id": rid + "-message", "role": "assistant",
                            "content": [{"type": "output_text", "text": text}]}
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.end_headers()
                try:
                    self.wfile.write(("data: " + json.dumps({"type": "response.created", "response": {"id": rid}}) + "\n\n").encode())
                    self.wfile.flush()
                    if child and active:
                        fixture.active_child_started.set()
                        fixture.active_child_release.wait(60)
                    for event in [
                        {"type": "response.output_item.done", "item": item},
                        {"type": "response.completed", "response": {"id": rid, "usage": {
                            "input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}}]:
                        self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.active_child_release.set()
        self.server.shutdown()
        self.server.server_close()


def spawn_family(native, base, fixture, active=False, approval=False):
    params = {"cwd": str(base), "model": "acceptance-model", "modelProvider": "acceptance"}
    if approval:
        params.update(approvalPolicy="on-request", sandbox="read-only")
    root = native.call("thread/start", params)["thread"]["id"]
    kind = "APPROVAL" if approval else "ACTIVE" if active else "IDLE"
    turn = native.call("turn/start", {"threadId": root, "input": [{"type": "text",
                             "text": f"ROOT_RELEASE_{kind}", "text_elements": []}]})["turn"]["id"]

    def children():
        data = native.call("thread/list", {"ancestorThreadId": root, "sourceKinds": ["subAgentThreadSpawn"],
                                          "limit": 100})["data"]
        return data if len(data) == 1 else False

    child = wait_for(children, "one real native child")[0]["id"]
    wait_for(lambda: any(event.get("params", {}).get("threadId") == root and
                        event.get("params", {}).get("turn", {}).get("id") == turn
                        for event in native.events("turn/completed")), "root turn completion")
    if active:
        wait_for(fixture.active_child_started.is_set, "active child fixture stream")
    elif not approval:
        wait_for(lambda: native.thread(child).get("status", {}).get("type") == "idle" and
                 "CHILD_HISTORY_RELEASE_OK" in json.dumps(native.thread(child, True)), "child completed history and idle")
    require(root in native.loaded() and child in native.loaded(), "Family was not loaded before release")
    metadata = native.thread(child)
    parent = metadata.get("parentThreadId") or metadata.get("source", {}).get("subAgent", {}).get("thread_spawn", {}).get("parent_thread_id")
    require(parent == root, "Native child parent identity does not match root")
    return root, child


def run(args):
    binary = Path(args.codex).expanduser().resolve(strict=True)
    output = Path(args.output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    base = output / ("run-" + time.strftime("%Y%m%dT%H%M%S", time.gmtime()) + "-" + uuid.uuid4().hex[:8])
    base.mkdir()
    env = isolated_environment(base)
    executable = binary
    if not os.access(binary, os.X_OK):
        # ZIP extraction can lose executable bits. Preserve the official tree and
        # execute a byte-identical private copy, never chmod the supplied artifact.
        private_bin = base / "private-binary"
        private_bin.mkdir()
        executable = private_bin / binary.name
        shutil.copy2(binary, executable)
        executable.chmod(0o700)
        for name in ("codex-code-mode-host", "codex-package.json"):
            source = binary.parent / name
            if source.is_file():
                target = private_bin / name
                shutil.copy2(source, target)
                if name == "codex-code-mode-host":
                    target.chmod(0o700)
        for name in ("codex-resources", "codex-path"):
            source = binary.parent / name
            if source.is_dir():
                (private_bin / name).symlink_to(source, target_is_directory=True)
    version = subprocess.check_output([str(executable), "--version"], cwd=base, env=env, text=True, timeout=10).strip()
    identity = {"path": str(binary), "executedPath": str(executable),
                "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "version": version}
    report = {"passed": False, "binary": identity, "artifactDirectory": str(base),
              "isolatedHome": True, "isolatedCodexHome": True, "remoteModelCalls": 0,
              "nativeCompatibilityOnly": True, "checks": {}}
    fixture, primary, competitor = Fixture(), None, None
    (base / "cli" / "config.toml").write_text(f'''model = "acceptance-model"
model_provider = "acceptance"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[features]
multi_agent = true
multi_agent_v2 = true
default_mode_request_user_input = true
goals = true
[model_providers.acceptance]
name = "isolated deterministic release fixture"
base_url = "http://127.0.0.1:{fixture.server.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
''')
    try:
        primary = Native(executable, env, base, "primary")
        report["initialize"] = primary.initialized
        root, child = spawn_family(primary, base, fixture)
        root_lock = base / "cli" / "thread-writer-locks" / (root + ".lock")
        child_lock = base / "cli" / "thread-writer-locks" / (child + ".lock")
        require(writer_locked(root_lock), "Root has no kernel writer lock before unsubscribe")
        require(writer_locked(child_lock), "Child has no kernel writer lock before unsubscribe")
        before = {tid: primary.thread(tid, True) for tid in (root, child)}
        require("ROOT_HISTORY_RELEASE_OK" in json.dumps(before[root]), "Root fixture history missing")
        require("CHILD_HISTORY_RELEASE_OK" in json.dumps(before[child]), "Child fixture history missing")
        resources = {tid: {"status": primary.thread(tid)["status"],
                          "goal": primary.call("thread/goal/get", {"threadId": tid}),
                          "backgroundTerminals": primary.call("thread/backgroundTerminals/list", {"threadId": tid})}
                     for tid in (root, child)}
        model_calls_before_release = len(fixture.calls)
        start = time.monotonic()
        receipt = primary.call("thread/unsubscribe", {"threadId": root})
        require(receipt.get("status") == "unsubscribed", f"Unexpected unsubscribe ACK: {receipt}")
        require(writer_locked(root_lock), "Unsubscribe ACK unexpectedly implies immediate writer release")
        wait_for(lambda: root not in primary.loaded() and not writer_locked(root_lock), "parent unload and kernel writer release")
        root_writer_release_ms = round((time.monotonic() - start) * 1000)
        wait_for(lambda: any(event.get("params", {}).get("threadId") == root
                            for event in primary.events("thread/closed")), "parent thread/closed")
        require(child in primary.loaded() and writer_locked(child_lock), "Parent unsubscribe stopped or unloaded the child")
        after = {tid: primary.thread(tid, True) for tid in (root, child)}
        require(after[root]["id"] == root and after[child]["id"] == child, "Read history changed a UUID")
        require("ROOT_HISTORY_RELEASE_OK" in json.dumps(after[root]), "Root history lost after parent unload")
        require("CHILD_HISTORY_RELEASE_OK" in json.dumps(after[child]), "Child history lost after parent unload")
        require(not writer_locked(root_lock), "Read-only history reacquired parent writer")
        competitor = Native(executable, env, base, "competitor")
        require(competitor.call("thread/resume", {"threadId": root})["thread"]["id"] == root, "Second native client did not acquire same parent UUID")
        require(writer_locked(root_lock), "Second native client did not acquire parent kernel writer")
        require("ROOT_HISTORY_RELEASE_OK" in json.dumps(competitor.thread(root, True)), "Second client lost parent history")
        competitor.call("thread/unsubscribe", {"threadId": root})
        wait_for(lambda: not writer_locked(root_lock), "second client writer release")
        require(primary.call("thread/resume", {"threadId": root})["thread"]["id"] == root, "Original client did not resume same parent UUID")
        require(primary.call("thread/resume", {"threadId": child})["thread"]["id"] == child, "Original client did not resume same child UUID")
        restored = {tid: primary.thread(tid, True) for tid in (root, child)}
        require("ROOT_HISTORY_RELEASE_OK" in json.dumps(restored[root]) and
                "CHILD_HISTORY_RELEASE_OK" in json.dumps(restored[child]), "History lost on same-UUID resume")
        require(len(fixture.calls) == model_calls_before_release, "Read, unsubscribe or resume unexpectedly started a model turn")
        next_turn = primary.call("turn/start", {"threadId": root, "input": [{"type": "text",
                                    "text": "ROOT_RESUME_EXERCISE", "text_elements": []}]})["turn"]["id"]
        wait_for(lambda: any(event.get("params", {}).get("threadId") == root and
                            event.get("params", {}).get("turn", {}).get("id") == next_turn
                            for event in primary.events("turn/completed")), "resumed root completion")
        wait_for(lambda: "CHILD_RESTORED_HISTORY_RELEASE_OK" in json.dumps(primary.thread(child, True)),
                 "resumed parent followup delivered to original child")
        resumed_descendants = primary.call("thread/list", {"ancestorThreadId": root,
                               "sourceKinds": ["subAgentThreadSpawn"], "limit": 100})["data"]
        require([item["id"] for item in resumed_descendants] == [child], "Resuming created a replacement child")
        restored_child_calls = sum(call["child"] and "CHILD_RELEASE_RESTORED" in call["latestFixtureInput"]
                                   for call in fixture.calls)
        require(restored_child_calls == 1, "Resumed parent task was not delivered exactly once to its original child")
        report["checks"]["idleFamilyParentOnlyRelease"] = {"passed": True, "root": root, "child": child,
             "unsubscribeReceipt": receipt, "writerReleaseMs": root_writer_release_ms,
             "childRemainedLoadedWithWriter": True, "sameUuidResume": True,
             "resumedParentFollowupToOriginalChild": True,
             "resumedChildModelCalls": restored_child_calls, "readAndResumeModelCalls": 0,
             "independentClientWriterAcquired": True, "historyPreserved": True,
             "resourcesBeforeRelease": resources}
        # Observe a genuine running child, without applying raw parent unsubscribe.
        active_root, active_child = spawn_family(primary, base, fixture, active=True)
        active_status = primary.thread(active_child)["status"]
        require(active_status.get("type") == "active", "Active child was incorrectly reported idle by native metadata")
        require(writer_locked(base / "cli" / "thread-writer-locks" / (active_root + ".lock")), "Active family parent lost writer without unsubscribe")
        report["checks"]["nativeActiveChildContract"] = {"passed": True, "root": active_root,
             "child": active_child, "status": active_status, "parentUnsubscribeRequests": 0,
             "scope": "Native active metadata and existing parent writer; runtime veto is a separate test"}
        fixture.active_child_release.set()
        wait_for(lambda: primary.thread(active_child)["status"]["type"] == "idle", "active child finish")
        # Native resource shapes are observed using actual pending requests and
        # processes. They are not substituted for runtime protection assertions.
        pending_root = primary.call("thread/start", {"cwd": str(base), "model": "acceptance-model",
                                                      "modelProvider": "acceptance"})["thread"]["id"]
        primary.call("turn/start", {"threadId": pending_root, "input": [{"type": "text",
                                                   "text": "ROOT_PENDING_EXERCISE", "text_elements": []}]})
        pending_request = wait_for(lambda: next((request for request in primary.events("item/tool/requestUserInput")
                                   if request.get("params", {}).get("threadId") == pending_root), None),
                                   "real native pending user input request")
        pending_status = wait_for(lambda: (status if "waitingOnUserInput" in status.get("activeFlags", []) else None)
                                  if (status := primary.thread(pending_root)["status"]) else None,
                                  "pending user input native active flag")
        require(writer_locked(base / "cli" / "thread-writer-locks" / (pending_root + ".lock")), "Pending thread lost writer")
        report["checks"]["nativePendingRequestContract"] = {"passed": True, "root": pending_root,
             "status": pending_status, "requestMethod": pending_request["method"], "parentUnsubscribeRequests": 0,
             "scope": "Native waitingOnUserInput metadata; runtime veto is a separate test"}
        primary.reply(pending_request["id"], {"answers": {"release_choice": {"answers": ["Complete"]}}})
        wait_for(lambda: primary.thread(pending_root)["status"]["type"] == "idle", "pending fixture completion")
        approval_root, approval_child = spawn_family(primary, base, fixture, approval=True)
        approval_request = wait_for(lambda: next((request for request in primary.events("item/commandExecution/requestApproval")
                                    if request.get("params", {}).get("threadId") == approval_child), None),
                                    "real native child approval request")
        approval_status = wait_for(lambda: (status if "waitingOnApproval" in status.get("activeFlags", []) else None)
                                   if (status := primary.thread(approval_child)["status"]) else None,
                                   "native child waitingOnApproval flag")
        require(writer_locked(base / "cli" / "thread-writer-locks" / (approval_root + ".lock")), "Approval family parent lost writer")
        report["checks"]["nativeChildApprovalContract"] = {"passed": True, "root": approval_root,
             "child": approval_child, "status": approval_status, "requestMethod": approval_request["method"],
             "parentUnsubscribeRequests": 0,
             "scope": "Native child waitingOnApproval metadata; runtime veto is a separate test"}
        primary.reply(approval_request["id"], {"decision": "decline"})
        wait_for(lambda: primary.thread(approval_child)["status"]["type"] == "idle", "declined child approval completion")
        background_root = primary.call("thread/start", {"cwd": str(base), "model": "acceptance-model",
                                                         "modelProvider": "acceptance"})["thread"]["id"]
        primary.call("turn/start", {"threadId": background_root, "input": [{"type": "text",
                                                      "text": "ROOT_BACKGROUND_EXERCISE", "text_elements": []}]})
        background = wait_for(lambda: (terminals if terminals.get("data") else None)
                              if (terminals := primary.call("thread/backgroundTerminals/list", {"threadId": background_root})) else None,
                              "real native background terminal")
        require(background.get("nextCursor") is None and len(background["data"]) == 1, "Unexpected background terminal fixture shape")
        terminal = background["data"][0]
        require(terminal.get("command") == "sleep 15", "Unexpected command in isolated background terminal")
        report["checks"]["nativeBackgroundTerminalContract"] = {"passed": True, "root": background_root,
             "terminal": terminal, "parentUnsubscribeRequests": 0,
             "scope": "Native nonempty terminal list; runtime veto is a separate test"}
        primary.call("thread/backgroundTerminals/terminate", {"threadId": background_root, "processId": terminal["processId"]})
        wait_for(lambda: not primary.call("thread/backgroundTerminals/list", {"threadId": background_root})["data"],
                 "only owned background terminal cleanup")
        goal = primary.call("thread/goal/set", {"threadId": root, "origin": "user",
                                "objective": "Observe isolated active goal", "status": "active", "tokenBudget": 100})["goal"]
        observed_goal = primary.call("thread/goal/get", {"threadId": root})["goal"]
        require(observed_goal and observed_goal.get("status") == "active", "Active goal missing from native getter")
        report["checks"]["nativeActiveGoalContract"] = {"passed": True, "root": root,
             "goal": observed_goal, "parentUnsubscribeRequests": 0,
             "scope": "Native active goal metadata; runtime veto is a separate test"}
        primary.call("thread/goal/set", {"threadId": root, "origin": "user", "status": "paused"})
        require(not (base / "cli" / "auth.json").exists(), "Unexpected auth material in isolated home")
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        fixture.active_child_release.set()
        if competitor:
            competitor.close()
        if primary:
            primary.close()
        fixture.close()
        report["localModelCalls"] = len(fixture.calls)
        report["fixtureCalls"] = fixture.calls
        (base / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        (output / "latest-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"passed": report["passed"], "binary": identity,
                          "checks": list(report["checks"]), "error": report.get("error"),
                          "localModelCalls": report["localModelCalls"], "remoteModelCalls": 0,
                          "result": str(base / "result.json")}, ensure_ascii=False, indent=2), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", required=True, help="Explicit native executable; never inferred from production env")
    parser.add_argument("--output-dir", required=True, help="Artifact parent; each run creates its own fresh subdirectory")
    run(parser.parse_args())
