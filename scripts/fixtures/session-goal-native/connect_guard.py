import array
import ctypes
import errno
import fcntl
import json
import os
import select
import socket
import struct
import threading
import time

class IOVec(ctypes.Structure):
    _fields_ = [("base", ctypes.c_void_p), ("length", ctypes.c_size_t)]

def start_connect_guard(control, allowed_port, log_path):
    message, ancillary, _, _ = control.recvmsg(64, socket.CMSG_SPACE(4))
    assert message == b"GOAL_ACCEPTANCE_CONNECT_LISTENER"
    descriptors = array.array("i")
    for level, kind, data in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            descriptors.frombytes(data[:len(data) - len(data) % descriptors.itemsize])
    assert len(descriptors) == 1
    listener = descriptors[0]
    os.set_blocking(listener, False)
    stopped = threading.Event()
    decisions = []
    libc = ctypes.CDLL(None, use_errno=True)
    libc.process_vm_readv.argtypes = [ctypes.c_int, ctypes.POINTER(IOVec), ctypes.c_ulong, ctypes.POINTER(IOVec), ctypes.c_ulong, ctypes.c_ulong]
    libc.process_vm_readv.restype = ctypes.c_ssize_t
    stream = log_path.open("w", buffering=1)
    def run():
        poller = select.poll(); poller.register(listener, select.POLLIN)
        while not stopped.is_set():
            if not poller.poll(100): continue
            request = bytearray(80)
            try: fcntl.ioctl(listener, 0xC0502100, request, True)
            except OSError as error:
                if error.errno in (errno.ENOENT, errno.EINTR, errno.EAGAIN): continue
                decisions.append({"guardError": repr(error)}); break
            identity, tid, flags, number, arch, ip, *args = struct.unpack("<QIIiIQ6Q", request)
            allowed = False
            detail = {"id": identity, "tid": tid, "syscall": number, "monotonicSeconds": round(time.monotonic(), 6)}
            if number == 42 and arch == 0xC000003E and args[2] >= 16:
                buffer = ctypes.create_string_buffer(128)
                local = IOVec(ctypes.cast(buffer, ctypes.c_void_p), min(args[2], 128))
                remote = IOVec(args[1], min(args[2], 128))
                copied = libc.process_vm_readv(tid, ctypes.byref(local), 1, ctypes.byref(remote), 1, 0)
                if copied >= 16:
                    family = struct.unpack_from("<H", buffer.raw)[0]
                    detail["family"] = family
                    if family == socket.AF_INET:
                        port = struct.unpack_from("!H", buffer.raw, 2)[0]
                        address = socket.inet_ntoa(buffer.raw[4:8])
                        detail.update(address=address, port=port)
                        allowed = address == "127.0.0.1" and port == allowed_port
                    elif family == socket.AF_UNIX:
                        detail["unixPath"] = buffer.raw[2:copied].split(b"\0")[0].decode(errors="replace")
                else: detail["readErrno"] = ctypes.get_errno()
            detail["allowed"] = allowed
            response = struct.pack("<QqiI", identity, 0, 0 if allowed else -errno.EPERM, 1 if allowed else 0)
            try: fcntl.ioctl(listener, 0xC0182101, response)
            except OSError as error:
                if error.errno != errno.ENOENT: detail["replyError"] = repr(error)
            decisions.append(detail); stream.write(json.dumps(detail) + "\n")
        stream.close()
    thread = threading.Thread(target=run, daemon=True); thread.start()
    def close():
        stopped.set(); thread.join(1)
        if not thread.is_alive(): os.close(listener)
    return decisions, close
