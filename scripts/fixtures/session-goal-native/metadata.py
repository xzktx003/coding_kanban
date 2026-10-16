#!/usr/bin/env python3
"""No-auth, no-model native Goal metadata acceptance. All evidence is written under the explicit output directory."""
import argparse
import fcntl
import hashlib
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

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--cli", required=True)
parser.add_argument("--output-dir", required=True)
args = parser.parse_args()
binary = Path(args.cli).resolve(strict=True)
base = Path(tempfile.mkdtemp(prefix="run-", dir=Path(args.output_dir).resolve(strict=True)))
base.chmod(0o700)
for name in ("home", "cli", "tmp", "app", "config", "cache", "data", "project"):
    (base / name).mkdir(mode=0o700)
env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL") if key in os.environ}
env.update(HOME=str(base / "home"), CODEX_HOME=str(base / "cli"),
           SESSION_DATA_HOME=str(base / "app"), TMPDIR=str(base / "tmp"),
           XDG_CONFIG_HOME=str(base / "config"), XDG_CACHE_HOME=str(base / "cache"),
           XDG_DATA_HOME=str(base / "data"), DO_NOT_TRACK="1", OTEL_SDK_DISABLED="true")
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as unused_provider:
    unused_provider.bind(("127.0.0.1", 0))
    metadata_port = unused_provider.getsockname()[1]
(base / "cli" / "config.toml").write_text('''model = "goal-metadata-offline-fixture"
model_provider = "goal_offline"
approval_policy = "never"
sandbox_mode = "read-only"
[features]
goals = true
[model_providers.goal_offline]
name = "No-network Goal metadata acceptance"
base_url = "http://127.0.0.1:%d/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
''' % metadata_port)

ledger = (base / "rpc.jsonl").open("w", buffering=1)
counter = 0
counter_lock = threading.Lock()
def record(label, direction, value):
    global counter
    with counter_lock:
        counter += 1
        ledger.write(json.dumps({"order": counter, "client": label, "direction": direction,
                                 "monotonicSeconds": round(time.monotonic(), 6), "message": value}) + "\n")

def writer_locked(path):
    try:
        stream = path.open("rb")
    except FileNotFoundError:
        # Native removes its writer lock file when an unloaded thread closes.
        return False
    with stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(stream, fcntl.LOCK_UN)
        return False

class Native:
    def __init__(self, label):
        self.label = label
        self.error_file = (base / (label + ".stderr.log")).open("w")
        self.process = subprocess.Popen(["strace", "-f", "-e", "trace=network", "-o", str(base / (label + ".network.log")),
            sys.executable, str(HERE / "no-network-exec.py"), str(binary), "app-server", "-c", "thread_unload_delay_secs=1"],
            cwd=base / "project", env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self.error_file, text=True, start_new_session=True)
        self.condition = threading.Condition()
        self.responses = {}
        self.messages = []
        self.next = 0
        def read():
            for line in self.process.stdout:
                message = json.loads(line)
                record(label, "receive", message)
                with self.condition:
                    self.messages.append(message)
                    if "id" in message and "method" not in message:
                        self.responses[message["id"]] = message
                    self.condition.notify_all()
        threading.Thread(target=read, daemon=True).start()
        try:
            self.initialized = self.call("initialize", {"clientInfo": {"name": "goal_metadata_" + label, "version": "1"},
                "capabilities": {"experimentalApi": True}})
            self.notify("initialized", {})
        except Exception:
            self.close()
            raise
    def notify(self, method, params):
        message = {"method": method, "params": params}
        record(self.label, "send", message)
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
    def call_response(self, method, params):
        self.next += 1
        identity = self.next
        message = {"id": identity, "method": method, "params": params}
        record(self.label, "send", message)
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
        end = time.monotonic() + 10
        with self.condition:
            while identity not in self.responses:
                if self.process.poll() is not None:
                    raise RuntimeError("Own native child exited during " + method)
                left = end - time.monotonic()
                if left <= 0: raise TimeoutError(method)
                self.condition.wait(min(left, .1))
            return self.responses.pop(identity)
    def call(self, method, params):
        response = self.call_response(method, params)
        if "error" in response: raise RuntimeError(method + ": " + json.dumps(response["error"]))
        return response["result"]
    def loaded(self):
        response = self.call("thread/loaded/list", {"limit": 100, "cursor": None})
        assert response.get("nextCursor") is None
        return response["data"]
    def close(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
        self.error_file.close()

report = {"passed": False, "artifactDirectory": str(base), "binary": {"path": str(binary), "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()},
          "isolation": {"privateHome": str(base / "home"), "privateCodexHome": str(base / "cli"), "authCopied": False,
                        "stdioOnly": True, "outboundConnectAndNetworkSocketDeniedBySeccomp": True,
                        "environmentKeys": sorted(env), "modelTurnRequests": 0}, "checks": {}}
clients = []
try:
    version = subprocess.check_output([sys.executable, str(HERE / "no-network-exec.py"), str(binary), "--version"],
        cwd=base, env=env, text=True, timeout=10, stderr=subprocess.PIPE).strip()
    report["binary"]["version"] = version
    primary = Native("primary"); clients.append(primary)
    report["initialize"] = primary.initialized
    created = primary.call("thread/start", {"cwd": str(base / "project"), "approvalPolicy": "never", "sandbox": "read-only", "ephemeral": False})
    thread = created["thread"]["id"]
    report["fixtureThread"] = {"id": thread, "path": created["thread"].get("path")}
    assert thread in primary.loaded()
    assert primary.call("thread/goal/get", {"threadId": thread}) == {"goal": None}
    initial = primary.call_response("thread/goal/set", {"threadId": thread, "objective": "Observe private paused Goal metadata only", "status": "paused", "tokenBudget": 100})
    report["checks"]["setWithoutOrigin"] = initial
    if "error" in initial:
        initial = primary.call_response("thread/goal/set", {"threadId": thread, "origin": "user", "objective": "Observe private paused Goal metadata only", "status": "paused", "tokenBudget": 100})
        report["checks"]["setWithExplicitOrigin"] = initial
    if "error" in initial: raise RuntimeError("Cannot create paused goal: " + json.dumps(initial))
    expected = initial["result"]["goal"]
    assert expected["status"] == "paused"
    assert primary.call("thread/goal/get", {"threadId": thread})["goal"] == expected
    report["checks"]["loadedRead"] = {"passed": True, "goal": expected}
    lock_path = base / "cli" / "thread-writer-locks" / (thread + ".lock")
    assert writer_locked(lock_path), "Primary must hold the real kernel writer lock"
    observer = Native("observer"); clients.append(observer)
    report["observerInitialize"] = observer.initialized
    before = observer.loaded()
    external = observer.call_response("thread/goal/get", {"threadId": thread})
    after = observer.loaded()
    report["checks"]["externalWriterRead"] = {"beforeLoaded": before, "response": external, "afterLoaded": after}
    assert thread not in before and after == before
    assert writer_locked(lock_path), "Read-only observer must not release the primary writer lock"
    report["checks"]["externalWriterRead"]["kernelWriterLockHeldBeforeAndAfter"] = True
    assert external.get("result", {}).get("goal") == expected
    report["checks"]["externalWriterRead"]["passed"] = True
    primary.call("thread/unsubscribe", {"threadId": thread})
    until = time.monotonic() + 10
    while thread in primary.loaded():
        if time.monotonic() > until: raise TimeoutError("own fixture thread unload")
        time.sleep(.1)
    assert not writer_locked(lock_path), "Unloaded fixture must no longer own a writer lock"
    unloaded = primary.call_response("thread/goal/get", {"threadId": thread})
    report["checks"]["unloadedRead"] = {"response": unloaded, "afterLoaded": primary.loaded()}
    report["checks"]["unloadedRead"]["kernelWriterLockReleased"] = True
    assert unloaded.get("result", {}).get("goal") == expected
    assert thread not in report["checks"]["unloadedRead"]["afterLoaded"]
    report["checks"]["unloadedRead"]["passed"] = True
    primary.call("thread/resume", {"threadId": thread})
    changed = primary.call("thread/goal/set", {"threadId": thread, "status": "paused", "tokenBudget": 200})
    assert changed["goal"]["tokenBudget"] == 200 and changed["goal"]["status"] == "paused"
    report["checks"]["pausedBudgetUpdate"] = {"passed": True, "response": changed}
    cleared = primary.call("thread/goal/clear", {"threadId": thread})
    assert cleared == {"cleared": True}
    assert primary.call("thread/goal/get", {"threadId": thread}) == {"goal": None}
    assert observer.call("thread/goal/get", {"threadId": thread}) == {"goal": None}
    assert primary.call("thread/goal/clear", {"threadId": thread}) == {"cleared": False}
    report["checks"]["clearRead"] = {"passed": True, "response": cleared}
    report["passed"] = True
except Exception as error:
    report["error"] = repr(error)
finally:
    for client in reversed(clients): client.close()
    report["isolation"]["ownedProcessCleanup"] = [{"label": client.label, "pid": client.process.pid, "exitCode": client.process.poll()} for client in clients]
    report["isolation"]["authFilesCreated"] = [str(file.relative_to(base)) for file in base.rglob("auth.json")]
    assert not report["isolation"]["authFilesCreated"]
    report["fixtureThreadPathExists"] = bool(report.get("fixtureThread", {}).get("path") and Path(report["fixtureThread"]["path"]).exists())
    ledger.close()
    messages = [json.loads(line) for line in (base / "rpc.jsonl").read_text().splitlines()]
    methods = [entry["message"]["method"] for entry in messages if entry["direction"] == "send" and "method" in entry["message"]]
    model_requests = [method for method in methods if method.startswith("turn/") or method == "review/start"]
    model_events = [entry["message"]["method"] for entry in messages if entry["direction"] == "receive" and entry["message"].get("method") in ("turn/started", "item/agentMessage/delta")]
    report["isolation"]["modelTurnRequests"] = len(model_requests)
    report["isolation"]["modelTurnEvents"] = model_events
    assert not model_requests and not model_events
    report["requestMethodsInOrder"] = [{"order": entry["order"], "client": entry["client"], "method": entry["message"]["method"]} for entry in messages if entry["direction"] == "send" and "method" in entry["message"]]
    network_audit = {}
    for client in clients:
        trace = (base / (client.label + ".network.log")).read_text()
        completed_connects = [line for line in trace.splitlines() if (" connect(" in line or "<... connect resumed>" in line) and " = " in line]
        assert all("= -1 EPERM" in line for line in completed_connects)
        assert "GOAL_ACCEPTANCE_NETWORK_AND_CONNECT_DENIAL_READY" in (base / (client.label + ".stderr.log")).read_text()
        network_audit[client.label] = {"allConnectCompletionsDenied": True, "connectAttempts": len(completed_connects), "denialSelfTestPassed": True}
    report["isolation"]["networkAudit"] = network_audit
    (base / "result.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(0 if report["passed"] else 1)
