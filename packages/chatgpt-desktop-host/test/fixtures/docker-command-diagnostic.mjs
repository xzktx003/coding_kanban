import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (path) =>
  typeof path === "string" &&
  isAbsolute(path) &&
  resolve(path) === path &&
  !/[\x00-\x20\x7f]/.test(path);
async function tool(path, hash) {
  if (
    !canonical(path) ||
    !/^[a-f0-9]{64}$/.test(hash) ||
    (await realpath(path)) !== path
  )
    throw Error("Fixed diagnostic tool invalid");
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true });
    if (
      !before.isFile() ||
      ![0n, BigInt(process.getuid())].includes(before.uid) ||
      before.mode & 0o022n ||
      !(before.mode & 0o111n) ||
      before.size > 256n * 1024n * 1024n
    )
      throw Error("Fixed diagnostic tool unsafe");
    if (sha(await fd.readFile()) !== hash)
      throw Error("Fixed diagnostic tool changed");
    const after = await lstat(path, { bigint: true });
    if (
      ["dev", "ino", "mode", "uid", "gid", "size", "mtimeNs", "ctimeNs"].some(
        (key) => before[key] !== after[key],
      )
    )
      throw Error("Fixed diagnostic tool changed");
  } finally {
    await fd.close();
  }
}

// Only for explicit server-side acceptance fixtures. No app import or CLI/HTTP
// endpoint activates this wrapper; it never reads account data or stdin.
export async function prepareFixtureDockerDiagnostic({
  directory,
  dockerPath,
  dockerSha256,
  pythonPath,
  pythonSha256,
}) {
  if (!canonical(directory) || (await realpath(directory)) !== directory)
    throw Error("Private diagnostic directory invalid");
  const parent = await lstat(directory, { bigint: true });
  if (
    !parent.isDirectory() ||
    parent.uid !== BigInt(process.getuid()) ||
    (parent.mode & 0o7777n) !== 0o700n
  )
    throw Error("Private diagnostic directory unsafe");
  await tool(dockerPath, dockerSha256);
  await tool(pythonPath, pythonSha256);
  const logPath = join(directory, "docker-commands.jsonl"),
    wrapperPath = join(directory, "docker-diagnostic.py");
  const log = await open(
    logPath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  let info;
  try {
    info = await log.stat({ bigint: true });
  } finally {
    await log.close();
  }
  const policy = {
    dockerPath,
    dockerSha256,
    logPath,
    uid: process.getuid(),
    directory,
    logDev: String(info.dev),
    logIno: String(info.ino),
  };
  const payload = Buffer.from(JSON.stringify(policy)).toString("base64");
  const source =
    "#!" +
    pythonPath +
    "\n" +
    String.raw`import base64,fcntl,hashlib,json,os,signal,stat,subprocess,sys,time,uuid
P=json.loads(base64.b64decode("PAYLOAD"))
started=time.monotonic()
invocation=uuid.uuid4().hex
args=sys.argv[1:]
stage=("image_inspect" if args[:2]==["image","inspect"] else args[0] if args and args[0] in {"create","start","inspect","exec","attach","logs","stop","rm","wait"} else "other")
child=None
external=None
def emit(value):
    parent=os.stat(P["directory"],follow_symlinks=False)
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=P["uid"] or stat.S_IMODE(parent.st_mode)!=0o700 or os.path.realpath(P["directory"])!=P["directory"]: raise RuntimeError("private_diagnostic_directory_changed")
    fd=os.open(P["logPath"],os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid!=P["uid"] or stat.S_IMODE(s.st_mode)!=0o600 or str(s.st_dev)!=P["logDev"] or str(s.st_ino)!=P["logIno"]: raise RuntimeError("private_diagnostic_log_changed")
        data=(json.dumps({"version":1,"invocation":invocation,"stage":stage,"elapsedMs":int((time.monotonic()-started)*1000),**value},separators=(",",":"))+"\n").encode()
        fcntl.flock(fd,fcntl.LOCK_EX)
        size=os.fstat(fd).st_size
        marker=b'{"version":1,"event":"truncated"}\n'
        if size>=len(marker) and os.pread(fd,len(marker),size-len(marker))==marker: return
        if size+len(data)>262144-len(marker):
            if size+len(marker)<=262144: os.write(fd,marker)
            return
        offset=0
        while offset<len(data): offset+=os.write(fd,data[offset:])
        os.fsync(fd)
    finally: os.close(fd)
def interrupted(number,frame):
    global external
    external=number
    if child is not None and child.poll() is None:
        try:child.send_signal(number)
        except ProcessLookupError:pass
signal.signal(signal.SIGTERM,interrupted)
signal.signal(signal.SIGINT,interrupted)
try: emit({"event":"begin"})
except Exception: sys.exit(125)
tool_fd=None
try:
    if os.path.realpath(P["dockerPath"])!=P["dockerPath"]: raise RuntimeError()
    tool_fd=os.open(P["dockerPath"],os.O_RDONLY|os.O_NOFOLLOW)
    before=os.fstat(tool_fd)
    if not stat.S_ISREG(before.st_mode) or before.st_uid not in {0,P["uid"]} or stat.S_IMODE(before.st_mode)&0o022 or not stat.S_IMODE(before.st_mode)&0o111 or before.st_size>268435456: raise RuntimeError()
    h=hashlib.sha256()
    while True:
        block=os.read(tool_fd,65536)
        if not block:break
        h.update(block)
    after=os.stat(P["dockerPath"],follow_symlinks=False)
    keys=("st_dev","st_ino","st_mode","st_uid","st_gid","st_size","st_mtime_ns","st_ctime_ns")
    if h.hexdigest()!=P["dockerSha256"] or any(getattr(before,k)!=getattr(after,k) for k in keys): raise RuntimeError()
except Exception as error:
    emit({"event":"result","reasonCode":"fixed_docker_identity_changed","errno":getattr(error,"errno",None),"exitCode":125,"signal":None,"externalSignal":None,"timeout":False,"stderr":"","stderrTruncated":False})
    if tool_fd is not None:os.close(tool_fd)
    sys.exit(125)
captured=bytearray()
total=0
code=None
errno=None
try:
    if external is None:
        os.lseek(tool_fd,0,os.SEEK_SET)
        child=subprocess.Popen([P["dockerPath"],*args],executable="/proc/self/fd/"+str(tool_fd),pass_fds=(tool_fd,),stderr=subprocess.PIPE)
        if external is not None and child.poll() is None:child.send_signal(external)
        emit({"event":"spawned"})
        while True:
            block=child.stderr.read(4096)
            if not block:break
            total+=len(block)
            captured.extend(block[:max(0,16384-len(captured))])
            try:sys.stderr.buffer.write(block);sys.stderr.buffer.flush()
            except BrokenPipeError:pass
        code=child.wait()
except OSError as error:
    errno=error.errno
    code=125
finally:os.close(tool_fd)
termination=external or (-code if code is not None and code<0 else None)
emit({"event":"result","errno":errno,"exitCode":code if code is not None and code>=0 else None,"signal":signal.Signals(termination).name if termination else None,"externalSignal":signal.Signals(external).name if external else None,"timeout":None if external else False,"stderr":captured.decode("utf-8","replace"),"stderrTruncated":total>len(captured)})
if termination:
    signal.signal(termination,signal.SIG_DFL)
    os.kill(os.getpid(),termination)
sys.exit(code if code is not None else 125)
`.replace("PAYLOAD", payload);
  await writeFile(wrapperPath, source, { flag: "wx", mode: 0o700 });
  return Object.freeze({
    dockerPath: wrapperPath,
    dockerSha256: sha(source),
    logPath,
  });
}
