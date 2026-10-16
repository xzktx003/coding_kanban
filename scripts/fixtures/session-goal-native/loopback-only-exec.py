#!/usr/bin/env python3
"""Apply inherited seccomp, handing connect decisions to the owning supervisor."""
import array
import ctypes
import errno
import os
import platform
import socket
import sys

if platform.machine() != "x86_64": raise SystemExit("x86_64 acceptance launcher only")
control_fd = int(sys.argv[1])
command = sys.argv[2:]
class Filter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte), ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]
class Program(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ushort), ("filters", ctypes.POINTER(Filter))]
deny = 0x00050000 | errno.EPERM
# connect is notified. Only AF_INET/SOCK_STREAM or AF_UNIX sockets can exist.
rules = [
    (0x20, 0, 0, 4), (0x15, 1, 0, 0xC000003E), (0x06, 0, 0, 0x80000000),
    (0x20, 0, 0, 0), (0x15, 0, 1, 42), (0x06, 0, 0, 0x7FC00000),
    (0x15, 0, 7, 41), (0x20, 0, 0, 16), (0x15, 5, 0, socket.AF_UNIX),
    (0x15, 0, 3, socket.AF_INET), (0x20, 0, 0, 24),
    (0x54, 0, 0, 0xF), (0x15, 1, 0, socket.SOCK_STREAM),
    (0x06, 0, 0, deny), (0x06, 0, 0, 0x7FFF0000),
]
filters = (Filter * len(rules))(*(Filter(*rule) for rule in rules))
program = Program(len(rules), filters)
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(38, 1, 0, 0, 0) != 0: raise OSError(ctypes.get_errno(), "no_new_privs")
listener = libc.syscall(317, 1, 8, ctypes.byref(program))
if listener < 0: raise OSError(ctypes.get_errno(), "seccomp NEW_LISTENER")
control = socket.socket(fileno=control_fd)
control.sendmsg([b"GOAL_ACCEPTANCE_CONNECT_LISTENER"], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [listener]))])
control.close()
os.close(listener)
for domain, kind in ((socket.AF_INET6, socket.SOCK_STREAM), (socket.AF_INET, socket.SOCK_DGRAM)):
    try: socket.socket(domain, kind)
    except PermissionError: pass
    else: raise SystemExit("Socket restriction self-test failed")
sys.stderr.write("GOAL_ACCEPTANCE_LOOPBACK_CONNECT_FILTER_READY\n")
sys.stderr.flush()
os.execvpe(command[0], command, os.environ)
