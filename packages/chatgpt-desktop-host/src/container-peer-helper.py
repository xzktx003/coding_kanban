#!/usr/bin/python3
"""Fixed host-side peer credential and bounded JSONL relay; never starts native."""
import json
import os
import select
import socket
import stat
import struct
import sys

MAX = 8 * 1024 * 1024
CHUNK = 65536

def fail():
    try:
        os.write(1, b'{"type":"error","code":"CONTAINER_PEER_UNAVAILABLE"}\n')
    except OSError:
        pass
    raise SystemExit(1)

def valid_path(path):
    return (isinstance(path, str) and os.path.isabs(path) and os.path.normpath(path) == path and
            len(os.fsencode(path)) <= 107 and not any(ord(c) < 32 or ord(c) == 127 for c in path))

def same(a, b):
    return (a.st_dev, a.st_ino, a.st_uid, a.st_mode) == (b.st_dev, b.st_ino, b.st_uid, b.st_mode)

def count_line(length, data):
    for part in data.splitlines(keepends=True):
        length += len(part)
        if length > MAX + 1:
            raise ValueError("frame budget")
        if part.endswith(b"\n"):
            length = 0
    return length

def main():
    if len(sys.argv) != 2 or not valid_path(sys.argv[1]): fail()
    path = sys.argv[1]
    try:
        parent = os.path.dirname(path)
        parent_info = os.lstat(parent)
        before = os.lstat(path)
        if (os.path.realpath(parent) != parent or not stat.S_ISDIR(parent_info.st_mode) or
            parent_info.st_uid != os.getuid() or stat.S_IMODE(parent_info.st_mode) != 0o700 or
            not stat.S_ISSOCK(before.st_mode) or before.st_uid != os.getuid() or
            stat.S_IMODE(before.st_mode) != 0o600): fail()
        peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        peer.settimeout(5)
        peer.connect(path)
        if not same(before, os.lstat(path)) or not same(parent_info, os.lstat(parent)): fail()
        pid, uid, gid = struct.unpack("3i", peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if pid <= 1 or uid != os.getuid(): fail()
        os.write(1, (json.dumps({"type":"peer", "pid":pid, "uid":uid, "gid":gid}, separators=(",", ":")) + "\n").encode())
        peer.setblocking(False)
        os.set_blocking(0, False)
        os.set_blocking(1, False)
        to_peer, to_host = bytearray(), bytearray()
        inbound_length = outbound_length = 0
        while True:
            reads, writes = [], []
            if len(to_peer) < MAX: reads.append(0)
            if len(to_host) < MAX: reads.append(peer)
            if to_peer: writes.append(peer)
            if to_host: writes.append(1)
            readable, writable, _ = select.select(reads, writes, [], 5)
            if 0 in readable:
                data = os.read(0, min(CHUNK, MAX - len(to_peer)))
                if not data: return
                outbound_length = count_line(outbound_length, data)
                to_peer.extend(data)
            if peer in readable:
                data = peer.recv(min(CHUNK, MAX - len(to_host)))
                if not data: return
                inbound_length = count_line(inbound_length, data)
                to_host.extend(data)
            if peer in writable:
                del to_peer[:peer.send(to_peer)]
            if 1 in writable:
                del to_host[:os.write(1, to_host)]
    except (OSError, ValueError):
        fail()

if __name__ == "__main__": main()
