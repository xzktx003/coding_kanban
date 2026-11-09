#!/usr/bin/python3
"""One private container-generation socket, started only by the fixed coordinator."""
import hmac
import fcntl
import json
import os
import secrets
import select
import socket
import stat
import subprocess
import sys
import time

MAX = 8 * 1024 * 1024
CHUNK = 65536
HISTORY_ROOT = "/kanban-codex-history"

def acquire_history_lease(account_binding):
    """One coordinator owns a rollout tree until its kernel-held fd closes."""
    if not isinstance(account_binding, str) or len(account_binding) != 64 or any(c not in "0123456789abcdef" for c in account_binding):
        raise ValueError("history binding")
    root = os.lstat(HISTORY_ROOT)
    if not stat.S_ISDIR(root.st_mode) or root.st_uid != os.getuid() or stat.S_IMODE(root.st_mode) != 0o700 or os.path.realpath(HISTORY_ROOT) != HISTORY_ROOT:
        raise ValueError("history root")
    manifest_fd = os.open(HISTORY_ROOT + "/manifest.json", os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(manifest_fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or info.st_size > 1024:
            raise ValueError("history manifest")
        manifest = json.loads(os.read(manifest_fd, 1025))
        if not isinstance(manifest, dict) or set(manifest) != {"version", "kind", "accountBinding"} or manifest["version"] != 1 or manifest["kind"] != "codex-rollouts" or manifest["accountBinding"] != account_binding:
            raise ValueError("history manifest")
    finally:
        os.close(manifest_fd)
    path = HISTORY_ROOT + "/.lease"
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        info, current = os.fstat(fd), os.lstat(path)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or info.st_size != 0 or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError("history lease")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except BaseException:
        os.close(fd)
        raise

def history_failure(phase):
    try:
        fd = os.open("/bridge/first-cause.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, line({"v": 1, "phase": phase}))
        finally:
            os.close(fd)
    except OSError:
        pass

def read_line(fd, timeout=40, cap=MAX):
    deadline, result = time.monotonic() + timeout, bytearray()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([fd], [], [], remaining)[0]: raise ValueError("timeout")
        part = os.read(fd, 1)
        if not part: raise ValueError("eof")
        result.extend(part)
        if len(result) > cap + 1: raise ValueError("budget")
        if part == b"\n": return bytes(result)

def line(value):
    return (json.dumps(value, separators=(",", ":")) + "\n").encode()

def count_line(length, data):
    for part in data.splitlines(keepends=True):
        length += len(part)
        if length > MAX + 1: raise ValueError("budget")
        if part.endswith(b"\n"): length = 0
    return length

def start_display():
    authority = "/tmp/desktop-Xauthority"
    fd = os.open(authority, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    cookie = secrets.token_hex(16)
    subprocess.run(["/usr/bin/xauth", "-f", authority, "add", ":98", ".", cookie], check=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={"PATH":"/usr/bin:/bin", "HOME":"/tmp"}, timeout=5)
    display = subprocess.Popen(["/usr/bin/Xvfb", ":98", "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-auth", authority],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={"PATH":"/usr/bin:/bin", "HOME":"/tmp"}, close_fds=True)
    deadline = time.monotonic() + 10
    while not os.path.exists("/tmp/.X11-unix/X98"):
        if display.poll() is not None or time.monotonic() > deadline: raise ValueError("display")
        time.sleep(0.05)
    return display

def main():
    if len(sys.argv) != 1: raise ValueError("arguments")
    info = os.lstat("/bridge/grant.json")
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 4096:
        raise ValueError("grant file")
    with open("/bridge/grant.json", "r", encoding="utf8") as stream: config = json.load(stream)
    required = {"version", "profileId", "generation", "runtimeRoot", "token"}
    if (not isinstance(config, dict) or not required.issubset(config) or set(config) - required - {"connection", "history"} or
        config["version"] != 1 or len(config["token"]) != 64): raise ValueError("grant config")
    history_lease = None
    if "history" in config:
        history = config["history"]
        if not isinstance(history, dict) or set(history) != {"version", "accountBinding"} or history["version"] != 1:
            raise ValueError("history config")
        try:
            history_lease = acquire_history_lease(history["accountBinding"])
        except BlockingIOError:
            history_failure("container_history_busy")
            raise
        except Exception:
            history_failure("container_history_invalid")
            raise
    os.umask(0o077)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind("/bridge/socket")
    os.chmod("/bridge/socket", 0o600)
    server.listen(1)
    node = None
    display = None
    node_line = ready_line = None
    dirty = False
    while True:
        waiting = [server]
        if node is not None: waiting.append(node.stdout.fileno())
        readable = select.select(waiting, [], [], 1)[0]
        if node is not None and node.stdout.fileno() in readable:
            if not os.read(node.stdout.fileno(), CHUNK): return
            dirty = True
        if server not in readable: continue
        client, _ = server.accept()
        try:
            challenge = secrets.token_hex(32)
            client.sendall(line({"type":"server", "bridgePid":os.getpid(), "profileId":config["profileId"],
                "generation":config["generation"], "challenge":challenge, "existing":node is not None, "dirty":dirty}))
            grant = json.loads(read_line(client.fileno(), 5, 4096))
            if (not isinstance(grant, dict) or set(grant) != {"type", "token", "challenge"} or grant["type"] != "grant" or
                not hmac.compare_digest(grant["token"], config["token"]) or not hmac.compare_digest(grant["challenge"], challenge) or dirty):
                raise ValueError("grant")
            if node is None:
                display = start_display()
                node = subprocess.Popen(["/opt/private-node", "/package/container-native.mjs", config["profileId"],
                    config["generation"], config["runtimeRoot"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, close_fds=True, bufsize=0,
                    env={"PATH":"/usr/bin:/bin", "HOME":"/tmp", "DISPLAY":":98", "XAUTHORITY":"/tmp/desktop-Xauthority", "LANG":"C.UTF-8"})
                node.stdin.write(line({"type":"grant", "token":config["token"]}))
                node_line = read_line(node.stdout.fileno(), 40, 4096)
                ready_line = read_line(node.stdout.fileno(), 40, MAX)
                if json.loads(node_line).get("type") != "node": raise ValueError("node")
            client.sendall(node_line)
            client.sendall(ready_line)
            client.setblocking(False)
            os.set_blocking(node.stdin.fileno(), False)
            os.set_blocking(node.stdout.fileno(), False)
            to_node, to_client = bytearray(), bytearray()
            in_length = out_length = 0
            while True:
                reads, writes = [], []
                if len(to_node) < MAX: reads.append(client)
                if len(to_client) < MAX: reads.append(node.stdout.fileno())
                if to_node: writes.append(node.stdin.fileno())
                if to_client: writes.append(client)
                readable, writable, _ = select.select(reads, writes, [], 5)
                if client in readable:
                    data = client.recv(min(CHUNK, MAX - len(to_node)))
                    if not data: break
                    in_length = count_line(in_length, data); to_node.extend(data)
                if node.stdout.fileno() in readable:
                    data = os.read(node.stdout.fileno(), min(CHUNK, MAX - len(to_client)))
                    if not data: return
                    out_length = count_line(out_length, data); to_client.extend(data)
                if node.stdin.fileno() in writable:
                    del to_node[:os.write(node.stdin.fileno(), to_node)]
                if client in writable:
                    del to_client[:client.send(to_client)]
            if to_node or to_client or in_length or out_length: dirty = True
        except (OSError, ValueError, TypeError, subprocess.SubprocessError):
            dirty = True
        finally:
            client.close()

if __name__ == "__main__":
    try: main()
    except Exception: raise SystemExit(1)
