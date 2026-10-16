#!/usr/bin/env python3
"""Only a private supervisor socket is used to install the inherited filter."""
import os
from pathlib import Path
import socket
import sys

control_path, binary, trace = sys.argv[1:]
control = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
control.connect("\0" + control_path[1:])
os.set_inheritable(control.fileno(), True)
os.execvp("strace", ["strace", "-f", "-e", "trace=network", "-o", trace, sys.executable,
    str(Path(__file__).resolve().parent / "loopback-only-exec.py"), str(control.fileno()), binary, "app-server", "-c", "thread_unload_delay_secs=1"])
