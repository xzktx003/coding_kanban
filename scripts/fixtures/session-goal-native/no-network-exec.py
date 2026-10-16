#!/usr/bin/env python3
"""Run only this acceptance child with no outbound network or IPC connects."""
import ctypes
import errno
import os
import platform
import socket
import sys

if platform.machine() != "x86_64":
    raise SystemExit("This acceptance seccomp filter is scoped to x86_64")

class Filter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte), ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]
class Program(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ushort), ("filters", ctypes.POINTER(Filter))]

deny = 0x00050000 | errno.EPERM
rules = [
    (0x20, 0, 0, 4),                  # seccomp_data.arch
    (0x15, 1, 0, 0xC000003E),         # AUDIT_ARCH_X86_64
    (0x06, 0, 0, 0x80000000),         # kill on another ABI
    (0x20, 0, 0, 0),                  # syscall number
    (0x15, 7, 0, 42),                 # deny connect (including any default IPC)
    (0x15, 6, 0, 44),                 # deny sendto
    (0x15, 5, 0, 46),                 # deny sendmsg
    (0x15, 0, 3, 41),                 # socket -> check domain
    (0x20, 0, 0, 16),                 # first syscall argument
    (0x15, 1, 0, socket.AF_UNIX),      # only local socket creation is allowed
    (0x06, 0, 0, deny),
    (0x06, 0, 0, 0x7FFF0000),         # allow
    (0x06, 0, 0, deny),
]
filters = (Filter * len(rules))(*(Filter(*rule) for rule in rules))
program = Program(len(rules), filters)
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(38, 1, 0, 0, 0) != 0 or libc.prctl(22, 2, ctypes.byref(program), 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "Cannot enforce acceptance network denial")
for domain in (socket.AF_INET, socket.AF_INET6):
    try:
        socket.socket(domain, socket.SOCK_STREAM)
    except PermissionError:
        pass
    else:
        raise SystemExit("Network denial self-test failed")
sys.stderr.write("GOAL_ACCEPTANCE_NETWORK_AND_CONNECT_DENIAL_READY\n")
sys.stderr.flush()
if len(sys.argv) < 2:
    raise SystemExit("Missing child command")
os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
