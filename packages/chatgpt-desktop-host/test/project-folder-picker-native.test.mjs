import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, rename, symlink, chmod, lstat, writeFile, readFile } from "node:fs/promises";
import { renameSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  createProjectFolderPicker,
} = require("../src/project-folder-picker-native.cjs");

async function fixture(dependencies = {}) {
  const dir = await mkdtemp(join(tmpdir(), "desktop-picker-")),
    home = join(dir, "home"),
    project = join(dir, "project");
  await mkdir(home, { mode: 0o700 });
  await mkdir(project, { mode: 0o775 });
  await chmod(project, 0o775);
  await mkdir(join(project, "first"));
  await mkdir(join(project, "second"));
  const sent = [],
    records = new Map(),
    owned = new WeakMap(),
    authority = { live: true };
  function addView() {
    const sender = { id: records.size + 1, isDestroyed: () => false },
      window = { webContents: sender, isDestroyed: () => false };
    const record = {
      viewId: randomUUID(),
      senderId: sender.id,
      window,
      failed: false,
    };
    records.set(sender.id, record);
    owned.set(sender, record);
    return { sender, record };
  }
  const a = addView(),
    b = addView();
  const rawPicker = createProjectFolderPicker(
    {
      homeRoot: home,
      projectRoots: [project],
      getRecord: (id) => records.get(id),
      getOwnedRecord: (sender) => owned.get(sender),
      verifyAuthority:
        dependencies.verifyAuthority ?? (async () => authority.live),
      verifyAuthoritySync: () => authority.live,
      sendToView: (record, message) => {
        sent.push({ record, message });
        dependencies.onSend?.(record, message);
      },
    },
    { verifyRootMount: () => true, ...dependencies },
  );
  const epochs = new WeakMap();
  const picker = {
    ...rawPicker,
    lifecycle(sender, message) {
      const accepted = rawPicker.lifecycle(sender, message);
      if (accepted) epochs.set(sender, message.epoch);
      return accepted;
    },
    reply(sender, message) {
      return rawPicker.reply(sender, { epoch: epochs.get(sender), ...message });
    },
  };
  if (!dependencies.manualLifecycle)
    for (const view of [a, b]) {
      assert.equal(
        picker.lifecycle(view.sender, {
          type: "kanban-project-folder-lifecycle",
          sequence: 1,
          epoch: randomUUID(),
        }),
        true,
      );
    }
  async function opened(index = 0) {
    for (
      let i = 0;
      i < 20 &&
      sent.filter((item) => item.message.type === "kanban-project-folder-open")
        .length <= index;
      i++
    )
      await new Promise((resolve) => setImmediate(resolve));
    return sent.filter(
      (item) => item.message.type === "kanban-project-folder-open",
    )[index];
  }
  async function close() {
    picker.dispose();
    await rm(dir, { recursive: true, force: true });
  }
  return {
    dir,
    home,
    project,
    sent,
    records,
    authority,
    a,
    b,
    picker,
    opened,
    close,
  };
}

test("default project creation is exclusive, view-bound and restricted to a configured mounted root", async () => {
  const f=await fixture();
  try {
    const target=join(f.project,"New project");
    f.picker.createDefault(f.a.sender,target);
    assert.equal((await lstat(target)).isDirectory(),true);
    assert.throws(()=>f.picker.createDefault(f.a.sender,target),{code:"PROJECT_FOLDER_PICKER_UNAVAILABLE"});
    for(const path of [join(f.home,"home-create"),join(f.project,"first","nested"),join(f.dir,"outside"),join(f.project,"..","escape")])
      assert.throws(()=>f.picker.createDefault(f.a.sender,path),{code:"PROJECT_FOLDER_PICKER_UNAVAILABLE"});
    const foreign={id:999,isDestroyed:()=>false};
    assert.throws(()=>f.picker.createDefault(foreign,join(f.project,"foreign")),{code:"PROJECT_FOLDER_PICKER_UNAVAILABLE"});
    f.picker.retire(f.a.sender);
    assert.throws(()=>f.picker.createDefault(f.a.sender,join(f.project,"retired")),{code:"PROJECT_FOLDER_PICKER_UNAVAILABLE"});
    await assert.rejects(lstat(join(f.project,"retired")),{code:"ENOENT"});
  } finally { await f.close(); }
});

test("default project creation refuses an unmounted root, changed authority, or a replaced root immediately before write", async () => {
  for(const state of ["unmounted","revoked","root-replaced"]){
    let f;
    f=await fixture({
      verifyRootMount:()=>state!=="unmounted",
      beforeDefaultCreate:()=>{
        if(state==="revoked")f.authority.live=false;
        if(state==="root-replaced"){renameSync(f.project,f.project+"-old");mkdirSync(f.project);}
      },
    });
    try {
      const target=join(f.project,"new");
      assert.throws(()=>f.picker.createDefault(f.a.sender,target),{code:"PROJECT_FOLDER_PICKER_UNAVAILABLE"},state);
      await assert.rejects(lstat(target),{code:"ENOENT"});
      if(state==="root-replaced")await assert.rejects(lstat(join(f.project+"-old","new")),{code:"ENOENT"});
    } finally { await f.close(); }
  }
});

test("default project creation does not follow an existing symlink or replace an existing file", async () => {
  const f=await fixture();
  try {
    const link=join(f.project,"link");await symlink(f.dir,link);
    assert.throws(()=>f.picker.createDefault(f.a.sender,link),{code:"PROJECT_FOLDER_PICKER_UNAVAILABLE"});
    assert.equal((await lstat(link)).isSymbolicLink(),true);
    const file=join(f.project,"file");await writeFile(file,"existing");
    assert.throws(()=>f.picker.createDefault(f.a.sender,file),{code:"PROJECT_FOLDER_PICKER_UNAVAILABLE"});
    assert.equal(await readFile(file,"utf8"),"existing");
  } finally { await f.close(); }
});

test("only canonical directories within fixed roots resolve; invalid input can be corrected", async () => {
  const f = await fixture();
  try {
    const pending = f.picker.open(f.a.sender, false),
      open = await f.opened();
    assert.equal(open.record, f.a.record);
    assert.equal(open.message.allowMultiple, false);
    const id = open.message.requestId;
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "select",
      paths: ["/etc"],
    });
    assert.equal(f.sent.at(-1).message.type, "kanban-project-folder-invalid");
    const selected = join(f.project, "first");
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "select",
      paths: [selected],
    });
    const result = await pending;
    assert.deepEqual(result, { canceled: false, filePaths: [selected] });
    const checked = f.picker.complete(f.a.sender, result, [selected]);
    assert.deepEqual(f.picker.consume(f.a.sender, checked), [selected]);
    assert.deepEqual(f.picker.consume(f.a.sender, checked), []);
  } finally {
    await f.close();
  }
});

test("cross-view, unexpected ids, duplicate requests and malformed response cannot resolve another request", async () => {
  const f = await fixture();
  try {
    const pending = f.picker.open(f.a.sender, true),
      open = await f.opened();
    assert.deepEqual(await f.picker.open(f.a.sender, false), {
      canceled: true,
      filePaths: [],
    });
    const id = open.message.requestId;
    await f.picker.reply(f.b.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "select",
      paths: [f.project],
    });
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: randomUUID(),
      action: "select",
      paths: [f.project],
    });
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "select",
      paths: [f.project],
      hostId: "forged",
    });
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "cancel",
    });
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("a view retirement while validation is pending cancels and never releases a late selection", async () => {
  let resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const f = await fixture({ beforePathCheck: async () => gate });
  try {
    const pending = f.picker.open(f.a.sender, false),
      open = await f.opened();
    const reply = f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: open.message.requestId,
      action: "select",
      paths: [f.project],
    });
    f.picker.retire(f.a.sender);
    resume();
    await reply;
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
    assert.ok(
      !f.sent.some(
        (item) => item.message.type === "kanban-project-folder-done",
      ),
    );
  } finally {
    resume();
    await f.close();
  }
});

test("authority revocation and replacement of a validated directory invalidate the final native result", async () => {
  for (const change of ["authority", "replacement"]) {
    const f = await fixture();
    try {
      const pending = f.picker.open(f.a.sender, false),
        open = await f.opened(),
        selected = join(f.project, "first");
      await f.picker.reply(f.a.sender, {
        type: "kanban-project-folder-reply",
        requestId: open.message.requestId,
        action: "select",
        paths: [selected],
      });
      const result = await pending;
      if (change === "authority") f.authority.live = false;
      else {
        await rename(selected, selected + "-old");
        await mkdir(selected);
      }
      assert.deepEqual(f.picker.complete(f.a.sender, result, [selected]), []);
    } finally {
      await f.close();
    }
  }
});

test("cancel, dispose and expiry return the native cancellation contract", async () => {
  let clock = 1000;
  const f = await fixture({ now: () => clock });
  try {
    const pending = f.picker.open(f.a.sender, false),
      open = await f.opened();
    clock += 120001;
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: open.message.requestId,
      action: "select",
      paths: [f.project],
    });
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
    const second = f.picker.open(f.b.sender, false);
    await f.opened(1);
    f.picker.dispose();
    assert.deepEqual(await second, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("retiring a view settles its request even when authority verification never completes", async () => {
  let resume;
  const waiting = new Promise((resolve) => {
    resume = resolve;
  });
  const f = await fixture({ verifyAuthority: () => waiting });
  try {
    const pending = f.picker.open(f.a.sender, false);
    await new Promise((resolve) => setImmediate(resolve));
    f.picker.retire(f.a.sender);
    const result = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
    ]);
    assert.deepEqual(result, { canceled: true, filePaths: [] });
  } finally {
    resume(true);
    await f.close();
  }
});

test("a user cancellation during slow path validation wins over the late result", async () => {
  let resume;
  const waiting = new Promise((resolve) => {
    resume = resolve;
  });
  const f = await fixture({ beforePathCheck: () => waiting });
  try {
    const pending = f.picker.open(f.a.sender, false),
      open = await f.opened(),
      id = open.message.requestId;
    const selecting = f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "select",
      paths: [f.project],
    });
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "cancel",
    });
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
    resume();
    await selecting;
    assert.ok(
      !f.sent.some(
        (item) => item.message.type === "kanban-project-folder-done",
      ),
    );
  } finally {
    resume();
    await f.close();
  }
});

test("symlink escape is rejected and multiple selections retain the exact validated directories", async () => {
  const f = await fixture();
  try {
    await symlink("/etc", join(f.project, "escape"));
    const pending = f.picker.open(f.a.sender, true),
      open = await f.opened(),
      id = open.message.requestId;
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "select",
      paths: [join(f.project, "escape")],
    });
    assert.equal(f.sent.at(-1).message.type, "kanban-project-folder-invalid");
    const paths = [join(f.project, "first"), join(f.project, "second")];
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: id,
      action: "select",
      paths,
    });
    const result = await pending;
    assert.deepEqual(result.filePaths, paths);
    const checked = f.picker.complete(f.a.sender, result, paths);
    assert.deepEqual(f.picker.consume(f.a.sender, checked), paths);
  } finally {
    await f.close();
  }
});

test("a selected view cannot start another picker until the original native stat handoff finishes", async () => {
  const f = await fixture();
  try {
    const first = f.picker.open(f.a.sender, false),
      request = await f.opened();
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: request.message.requestId,
      action: "select",
      paths: [f.project],
    });
    const result = await first;
    const duplicate = f.picker.open(f.a.sender, false);
    assert.deepEqual(
      await Promise.race([
        duplicate,
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
      ]),
      { canceled: true, filePaths: [] },
    );
    const checked = f.picker.complete(f.a.sender, result, [f.project]);
    assert.deepEqual(f.picker.consume(f.a.sender, checked), [f.project]);
    const next = f.picker.open(f.a.sender, false),
      opened = await f.opened(1);
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: opened.message.requestId,
      action: "cancel",
    });
    assert.deepEqual(await next, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("a failed path stops a multiple selection before starting later filesystem work", async () => {
  const seen = [],
    f = await fixture({ beforePathCheck: async (value) => seen.push(value) });
  try {
    const pending = f.picker.open(f.a.sender, true),
      request = await f.opened();
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: request.message.requestId,
      action: "select",
      paths: ["/etc", f.project],
    });
    assert.deepEqual(seen, []);
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: request.message.requestId,
      action: "cancel",
    });
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("a newer lifecycle epoch revokes old requests and cannot be rolled back by late messages", async () => {
  const f = await fixture({ manualLifecycle: true });
  try {
    const firstEpoch = randomUUID(),
      secondEpoch = randomUUID();
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 1,
        epoch: firstEpoch,
      }),
      true,
    );
    const pending = f.picker.open(f.a.sender, false),
      opened = await f.opened();
    assert.equal(opened.message.epoch, firstEpoch);
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 2,
        epoch: secondEpoch,
      }),
      true,
    );
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 1,
        epoch: firstEpoch,
      }),
      false,
    );
    const next = f.picker.open(f.a.sender, false),
      nextOpen = await f.opened(1);
    assert.equal(nextOpen.message.epoch, secondEpoch);
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: nextOpen.message.requestId,
      epoch: firstEpoch,
      action: "select",
      paths: [f.project],
    });
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: nextOpen.message.requestId,
      epoch: secondEpoch,
      action: "cancel",
    });
    assert.deepEqual(await next, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("native ACK proves applied lifecycle, inactive denies open, and an old epoch cannot be reused", async () => {
  const f = await fixture({ manualLifecycle: true });
  try {
    const afterRetire = f.picker.open(f.a.sender, false);
    assert.deepEqual(
      await Promise.race([
        afterRetire,
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
      ]),
      { canceled: true, filePaths: [] },
    );
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 1,
        epoch: null,
      }),
      true,
    );
    assert.deepEqual(f.sent.at(-1).message, {
      type: "kanban-project-folder-lifecycle-ack",
      sequence: 1,
      epoch: null,
    });
    assert.deepEqual(await f.picker.open(f.a.sender, false), {
      canceled: true,
      filePaths: [],
    });
    const old = randomUUID();
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 2,
        epoch: old,
      }),
      true,
    );
    const pending = f.picker.open(f.a.sender, false);
    await f.opened();
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 3,
        epoch: null,
      }),
      true,
    );
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 4,
        epoch: old,
      }),
      false,
    );
    assert.deepEqual(await f.picker.open(f.a.sender, false), {
      canceled: true,
      filePaths: [],
    });
  } finally {
    await f.close();
  }
});

test("retiring a view revokes its old active lifecycle until a fresh sequence and epoch", async () => {
  const f = await fixture({ manualLifecycle: true });
  try {
    const first = randomUUID();
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 1,
        epoch: first,
      }),
      true,
    );
    f.picker.retire(f.a.sender);
    const afterRetire = f.picker.open(f.a.sender, false);
    assert.deepEqual(
      await Promise.race([
        afterRetire,
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
      ]),
      { canceled: true, filePaths: [] },
    );
    const next = randomUUID();
    assert.equal(
      f.picker.lifecycle(f.a.sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 2,
        epoch: next,
      }),
      true,
    );
    const pending = f.picker.open(f.a.sender, false),
      open = await f.opened();
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: open.message.requestId,
      epoch: next,
      action: "cancel",
    });
    assert.deepEqual(await pending, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("a synchronous lifecycle change during done cannot install a stale handoff", async () => {
  let picker;
  let sender;
  const nextEpoch = randomUUID();
  const f = await fixture({
    manualLifecycle: true,
    onSend(_record, message) {
      if (message.type === "kanban-project-folder-done") {
        assert.equal(
          picker.lifecycle(sender, {
            type: "kanban-project-folder-lifecycle",
            sequence: 2,
            epoch: nextEpoch,
          }),
          true,
        );
      }
    },
  });
  try {
    picker = f.picker;
    sender = f.a.sender;
    assert.equal(
      picker.lifecycle(sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 1,
        epoch: randomUUID(),
      }),
      true,
    );
    const first = picker.open(sender, false),
      opened = await f.opened();
    await picker.reply(sender, {
      type: "kanban-project-folder-reply",
      requestId: opened.message.requestId,
      action: "select",
      paths: [f.project],
    });
    assert.deepEqual(await first, { canceled: true, filePaths: [] });
    const second = picker.open(sender, false),
      openedNext = await f.opened(1);
    assert.ok(
      openedNext,
      "the new activation must not be blocked by a stale handoff",
    );
    await picker.reply(sender, {
      type: "kanban-project-folder-reply",
      requestId: openedNext.message.requestId,
      action: "cancel",
    });
    assert.deepEqual(await second, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("a lifecycle change or expiry detaches an old handoff while keeping late results invalid", async () => {
  for (const reason of ["epoch", "expiry"]) {
    let clock = 1000;
    const f = await fixture({ now: () => clock });
    try {
      const first = f.picker.open(f.a.sender, false),
        opened = await f.opened();
      await f.picker.reply(f.a.sender, {
        type: "kanban-project-folder-reply",
        requestId: opened.message.requestId,
        action: "select",
        paths: [f.project],
      });
      const result = await first;
      if (reason === "epoch")
        assert.equal(
          f.picker.lifecycle(f.a.sender, {
            type: "kanban-project-folder-lifecycle",
            sequence: 2,
            epoch: randomUUID(),
          }),
          true,
        );
      else clock += 120001;
      const next = f.picker.open(f.a.sender, false),
        nextOpen = await f.opened(1);
      assert.ok(nextOpen, `${reason} must release the view for a new request`);
      assert.deepEqual(f.picker.complete(f.a.sender, result, [f.project]), []);
      await f.picker.reply(f.a.sender, {
        type: "kanban-project-folder-reply",
        requestId: nextOpen.message.requestId,
        action: "cancel",
      });
      assert.deepEqual(await next, { canceled: true, filePaths: [] });
    } finally {
      await f.close();
    }
  }
});

test("detached original stat handoffs remain inside the global 16-operation budget", async () => {
  const f = await fixture();
  try {
    const results = [];
    for (let i = 0; i < 16; i++) {
      const selection = f.picker.open(f.a.sender, false),
        opened = await f.opened(i);
      assert.ok(opened);
      await f.picker.reply(f.a.sender, {
        type: "kanban-project-folder-reply",
        requestId: opened.message.requestId,
        action: "select",
        paths: [f.project],
      });
      results.push(await selection);
      assert.equal(
        f.picker.lifecycle(f.a.sender, {
          type: "kanban-project-folder-lifecycle",
          sequence: i + 2,
          epoch: randomUUID(),
        }),
        true,
      );
    }
    assert.deepEqual(await f.picker.open(f.a.sender, false), {
      canceled: true,
      filePaths: [],
    });
    assert.deepEqual(
      f.picker.complete(f.a.sender, results[0], [f.project]),
      [],
    );
    const allowed = f.picker.open(f.a.sender, false),
      opened = await f.opened(16);
    assert.ok(opened, "one completed original stat frees one budget slot");
    await f.picker.reply(f.a.sender, {
      type: "kanban-project-folder-reply",
      requestId: opened.message.requestId,
      action: "cancel",
    });
    assert.deepEqual(await allowed, { canceled: true, filePaths: [] });
  } finally {
    await f.close();
  }
});

test("direct native paths require the current owned view and stay inside fixed canonical roots", async () => {
  const f = await fixture();
  try {
    await symlink("/etc", join(f.project, "escape"));
    for (const paths of [
      ["/etc"],
      [join(f.project, "escape")],
      [f.project, "/etc"],
      [f.project, f.project],
    ])
      assert.deepEqual(await f.picker.direct(f.a.sender, paths), {
        canceled: true,
        filePaths: [],
      });
    const chosen = join(f.project, "first"),
      result = await f.picker.direct(f.a.sender, [chosen]);
    assert.deepEqual(result, { canceled: false, filePaths: [chosen] });
    assert.deepEqual(f.picker.complete(f.b.sender, result, [chosen]), []);
    const checked = f.picker.complete(f.a.sender, result, [chosen]);
    assert.deepEqual(f.picker.consume(f.a.sender, checked), [chosen]);
    f.picker.retire(f.a.sender);
    assert.deepEqual(await f.picker.direct(f.a.sender, [chosen]), {
      canceled: true,
      filePaths: [],
    });
  } finally {
    await f.close();
  }
});

test("retiring a view cancels slow direct path checks and refuses their late result", async () => {
  let resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const f = await fixture({ beforePathCheck: () => gate });
  try {
    const pending = f.picker.direct(f.a.sender, [f.project]);
    await new Promise((resolve) => setImmediate(resolve));
    f.picker.retire(f.a.sender);
    assert.deepEqual(
      await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
      ]),
      { canceled: true, filePaths: [] },
    );
    resume();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      f.sent.filter(
        (item) => item.message.type === "kanban-project-folder-open",
      ).length,
      0,
    );
  } finally {
    resume();
    await f.close();
  }
});
