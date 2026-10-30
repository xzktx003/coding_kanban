import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { SessionDatabase } from "../storage/database.js";
import { createAcpService } from "./index.js";
import { acpHistorySessionId } from "./history-identity.js";

const fixture = String.raw`
const readline = require('node:readline'); let waiting;
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const reply = (m,result) => send({id:m.id,result});
readline.createInterface({input:process.stdin}).on('line',line => {
  const m=JSON.parse(line),p=m.params||{};
  if(!m.method) { if(waiting) { reply(waiting,{stopReason:'end_turn'}); waiting=undefined; } return; }
  if(m.method==='initialize') return reply(m,{protocolVersion:1,agentCapabilities:{loadSession:true}});
  if(m.method==='session/new'||m.method==='session/load') return reply(m,{sessionId:'s1'});
  if(m.method==='session/prompt') {
    if(p.prompt[0].text==='permission') { waiting=m;send({id:99,method:'session/request_permission',params:{sessionId:'s1',toolCall:{title:'Only '+process.env.OWNER,kind:'read'},options:[{optionId:'yes',kind:'allow_once'}]}});return; }
    send({method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'answer-'+process.env.OWNER}}}});
    return reply(m,{stopReason:'end_turn'});
  }
  reply(m,{});
});`;

test(
  "two independent ACP connections with the same native session ID never share their SQLite transcript",
  { timeout: 10_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-native-session-collision-")),
      hub = new EventHub(),
      history = new SessionDatabase(root);
    const service = createAcpService({
      hub,
      history,
      dataHome: root,
      env: { HOME: root, PATH: process.env.PATH },
      runtimeInstance: "private-collision-runtime",
    });
    try {
      const start = async (owner: string) =>
        service.start({
          agent_id: owner,
          cwd: root,
          custom: {
            id: owner,
            name: owner,
            command: process.execPath,
            args: ["-e", fixture, "--"],
            env: { OWNER: owner },
          },
        });
      const a = await start("owner-a"),
        b = await start("owner-b");
      assert.notEqual(a.connectionId, b.connectionId);
      assert.equal(a.sessionId, "s1");
      assert.equal(b.sessionId, "s1");
      await service.prompt(a.connectionId, a.sessionId!, "alpha");
      await service.prompt(b.connectionId, b.sessionId!, "beta");
      const pending = service.prompt(
        a.connectionId,
        a.sessionId!,
        "permission",
      );
      void pending.catch(() => {});
      let snapshot = service.connectionSnapshot(
        a.connectionId,
        "s1",
        service.runtimeInstance,
      );
      for (
        let attempt = 0;
        snapshot.permissions.length === 0 && attempt < 100;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        snapshot = service.connectionSnapshot(
          a.connectionId,
          "s1",
          service.runtimeInstance,
        );
      }
      assert.equal(snapshot.permissions.length, 1);
      assert.throws(
        () => service.deleteSession(a.historySessionId!),
        /active|pending|unknown/i,
        "a stale history-delete request must not erase a background owner's active transcript",
      );
      assert.ok(history.getSessionInfo(a.historySessionId!));
      assert.equal(
        service.connectionSnapshot(
          b.connectionId,
          "s1",
          service.runtimeInstance,
        ).permissions.length,
        0,
      );
      const requestId = String(snapshot.permissions[0]!.requestId);
      await assert.rejects(
        service.respondPermission(b.connectionId, requestId, "yes", "s1"),
      );
      await service.respondPermission(a.connectionId, requestId, "yes", "s1");
      await pending;
      const sessions = history.listSessions(),
        raw = history.getUpdates("s1");
      console.log(
        "ACP_TWO_OWNER_SQLITE",
        JSON.stringify({
          sameNativeId: a.sessionId === b.sessionId,
          distinctConnections: a.connectionId !== b.connectionId,
          sessions,
          raw,
          permissionsIsolatedByConnection: true,
        }),
      );
      assert.equal(
        sessions.length,
        2,
        "each ACP owner needs an independent persisted history source even if both native RPC IDs are s1",
      );
      assert.ok(a.historySessionId);
      assert.ok(b.historySessionId);
      assert.notEqual(a.historySessionId, b.historySessionId);
      assert.equal(snapshot.historySessionId, a.historySessionId);
      assert.equal(
        sessions.find((row) => row.sessionId === a.historySessionId)
          ?.nativeSessionId,
        "s1",
      );
      const left = JSON.stringify(history.getUpdates(a.historySessionId!)),
        right = JSON.stringify(history.getUpdates(b.historySessionId!));
      assert.match(left, /alpha/);
      assert.match(left, /answer-owner-a/);
      assert.doesNotMatch(left, /beta|answer-owner-b/);
      assert.match(right, /beta/);
      assert.match(right, /answer-owner-b/);
      assert.doesNotMatch(right, /alpha|answer-owner-a/);
      assert.deepEqual(raw, []);
      assert.deepEqual(service.getSession("s1"), []);
      const aPage = await service.getRecentSession(a.historySessionId!, {}),
        bPage = await service.getRecentSession(b.historySessionId!, {});
      assert.match(JSON.stringify(aPage.data), /answer-owner-a/);
      assert.doesNotMatch(JSON.stringify(aPage.data), /answer-owner-b/);
      assert.match(JSON.stringify(bPage.data), /answer-owner-b/);
      assert.notEqual(aPage.data[0]!.id, bPage.data[0]!.id);
      const reload = (await service.loadSession(
        a.connectionId,
        "s1",
        root,
      )) as { historySessionId: string };
      assert.equal(reload.historySessionId, a.historySessionId);
      assert.equal(
        JSON.stringify(history.getUpdates(a.historySessionId!)),
        left,
      );
      const third = await start("owner-a");
      assert.notEqual(third.historySessionId, a.historySessionId);
      await service.prompt(third.connectionId, "s1", "third");
      assert.doesNotMatch(
        JSON.stringify(history.getUpdates(a.historySessionId!)),
        /third/,
      );
      assert.equal(
        acpHistorySessionId(
          service.runtimeInstance,
          a.connectionId,
          "owner-a",
          "s1",
        ),
        a.historySessionId,
      );
      assert.throws(
        () =>
          history.upsertSession({
            sessionId: a.historySessionId!,
            nativeSessionId: "s1",
            runtimeInstance: service.runtimeInstance,
            connectionId: b.connectionId,
            agentId: "owner-a",
            cwd: root,
          }),
        /owner identity/,
      );
      await service.close();
      history.close();
      const reopened = new SessionDatabase(root);
      try {
        assert.equal(
          JSON.stringify(reopened.getUpdates(a.historySessionId!)),
          left,
        );
        assert.equal(
          reopened.getSessionInfo(a.historySessionId!)?.historyScope,
          "scoped",
        );
        assert.deepEqual(reopened.getUpdates("s1"), []);
      } finally {
        reopened.close();
      }
    } finally {
      await service.close();
      hub.close();
      if (history.db.open) history.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "legacy bare-ID history remains readable and cannot be adopted by a new ACP owner",
  { timeout: 10_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-legacy-history-")),
      hub = new EventHub(),
      history = new SessionDatabase(root);
    history.upsertSession({ sessionId: "s1", agentId: "owner-a", cwd: root });
    history.appendUpdate("s1", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "legacy-only-body" },
    });
    const service = createAcpService({
      hub,
      history,
      dataHome: root,
      env: { HOME: root, PATH: process.env.PATH },
      runtimeInstance: "new-runtime",
    });
    try {
      const start = await service.start({
        agent_id: "owner-a",
        cwd: root,
        custom: {
          id: "owner-a",
          name: "A",
          command: process.execPath,
          args: ["-e", fixture, "--"],
          env: { OWNER: "owner-a" },
        },
      });
      await service.prompt(start.connectionId, "s1", "new-only-body");
      assert.equal(history.getSessionInfo("s1")?.historyScope, "legacy");
      assert.equal(history.getSessionInfo("s1")?.nativeSessionId, null);
      assert.match(
        JSON.stringify(service.getSession("s1")),
        /legacy-only-body/,
      );
      assert.doesNotMatch(
        JSON.stringify(service.getSession("s1")),
        /new-only-body/,
      );
      assert.match(
        JSON.stringify(service.getSession(start.historySessionId!)),
        /new-only-body/,
      );
      assert.doesNotMatch(
        JSON.stringify(service.getSession(start.historySessionId!)),
        /legacy-only-body/,
      );
      const fresh = createAcpService({
        hub,
        history,
        dataHome: root,
        runtimeInstance: "different-runtime",
      });
      try {
        assert.throws(
          () =>
            fresh.connectionSnapshot(
              start.connectionId,
              "s1",
              start.runtimeInstance,
            ),
          /runtime.*changed/i,
        );
        assert.match(
          JSON.stringify(fresh.getSession(start.historySessionId!)),
          /new-only-body/,
        );
      } finally {
        await fresh.close();
      }
    } finally {
      await service.close();
      hub.close();
      history.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "an explicit native load records its real replay into a fresh source and readonly refresh never loads or duplicates it",
  { timeout: 10_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-native-replay-")),
      hub = new EventHub(),
      history = new SessionDatabase(root);
    const replayFixture = fixture.replace(
      "if(m.method==='session/new'||m.method==='session/load') return reply(m,{sessionId:'s1'});",
      "if(m.method==='session/new') return reply(m,{sessionId:'s1'}); if(m.method==='session/load') { send({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'original native question'}}}}); send({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'actual native replay answer'}}}}); return reply(m,{sessionId:p.sessionId}); }",
    );
    const service = createAcpService({
      hub,
      history,
      dataHome: root,
      env: { HOME: root, PATH: process.env.PATH },
    });
    const subscription = hub.subscribe({ agents: "acp", since: 0 });
    try {
      history.upsertSession({ sessionId: "s1", agentId: "owner-a", cwd: root });
      history.appendUpdate("s1", {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "unverified legacy body must stay separate",
        },
      });
      const { client } = await service.connect({
        cwd: root,
        agent: {
          id: "owner-a",
          name: "A",
          command: process.execPath,
          args: ["-e", replayFixture, "--"],
          env: { OWNER: "owner-a" },
        },
      });
      const loaded = (await service.loadSession(
        client.connectionId,
        "s1",
        root,
      )) as { sessionId: string; historySessionId: string };
      assert.equal(loaded.sessionId, "s1");
      assert.match(loaded.historySessionId, /^acph_[a-f0-9]{64}$/);
      const original = history.getUpdates(loaded.historySessionId) as {
        historyReplayed?: boolean;
      }[];
      assert.equal(
        original.length,
        2,
        "fresh source must persist actual native load replay before the client starts a later turn",
      );
      assert.ok(original.every((row) => row.historyReplayed === true));
      assert.doesNotMatch(JSON.stringify(original), /unverified legacy/);
      const event1 = (await subscription.next()).value!.payload as any,
        event2 = (await subscription.next()).value!.payload as any;
      assert.equal(event1.historySessionId, loaded.historySessionId);
      assert.equal(event2.historySessionId, loaded.historySessionId);
      assert.ok(Number.isSafeInteger(event1.historySourceId));
      const snap = service.connectionSnapshot(
        client.connectionId,
        "s1",
        service.runtimeInstance,
      );
      assert.equal(snap.historySessionId, loaded.historySessionId);
      assert.equal(snap.running, false);
      assert.equal(
        (await service.getRecentSession(loaded.historySessionId, {})).data
          .length,
        2,
      );
      await service.loadSession(client.connectionId, "s1", root);
      assert.deepEqual(history.getUpdates(loaded.historySessionId), original);
      await service.prompt(client.connectionId, "s1", "followup after replay");
      const final = history.getUpdates(loaded.historySessionId);
      assert.equal(final.length, 4);
      assert.match(JSON.stringify(final), /followup after replay/);
      const before = JSON.stringify(final);
      await service.close();
      history.close();
      const reopened = new SessionDatabase(root);
      try {
        const reader = createAcpService({
          hub,
          history: reopened,
          dataHome: root,
        });
        try {
          assert.equal(
            JSON.stringify(reader.getSession(loaded.historySessionId)),
            before,
          );
          assert.equal(
            (await reader.getRecentSession(loaded.historySessionId, {})).data
              .length,
            4,
          );
          assert.equal(reader.activitySnapshot().connections, 0);
          assert.match(
            JSON.stringify(reader.getSession("s1")),
            /unverified legacy/,
          );
        } finally {
          await reader.close();
        }
      } finally {
        reopened.close();
      }
    } finally {
      subscription.close();
      await service.close();
      hub.close();
      if (history.db.open) history.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

for (const [method, result] of [
  ["new", {}],
  ["new", { sessionId: 42 }],
  ["new", { sessionId: "invalid\nidentity" }],
  ["load", { sessionId: "other-session" }],
  ["load", { sessionId: null }],
  ["load", null],
  ["load", []],
] as const) {
  test(
    `ACP ${method} with malformed lifecycle result ${JSON.stringify(result)} preserves unknown outcome and blocks another write`,
    { timeout: 10_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "acp-lifecycle-identity-")),
        hub = new EventHub(),
        history = new SessionDatabase(root),
        trace = join(root, "native-requests.jsonl");
      const broken = fixture
        .replace(
          "const m=JSON.parse(line),p=m.params||{};",
          "const m=JSON.parse(line),p=m.params||{};require('node:fs').appendFileSync(process.env.TRACE_FILE,JSON.stringify(m.method)+'\\n');",
        )
        .replace(
          "if(m.method==='session/new'||m.method==='session/load') return reply(m,{sessionId:'s1'});",
          "if(m.method==='session/new'||m.method==='session/load') return reply(m,JSON.parse(process.env.LIFECYCLE_RESULT));",
        );
      const service = createAcpService({
        hub,
        history,
        dataHome: root,
        env: { HOME: root, PATH: process.env.PATH },
      });
      try {
        const { client } = await service.connect({
          cwd: root,
          agent: {
            id: "fixture",
            name: "Fixture",
            command: process.execPath,
            args: ["-e", broken, "--"],
            env: {
              TRACE_FILE: trace,
              LIFECYCLE_RESULT: JSON.stringify(result),
            },
          },
        });
        const write =
          method === "new"
            ? () => client.newSession(root)
            : () => client.loadSession("s1", root);
        await assert.rejects(write(), /DELIVERY_UNKNOWN/);
        const before = await readFile(trace, "utf8");
        await assert.rejects(client.newSession(root), /DELIVERY_UNKNOWN/);
        await assert.rejects(
          client.prompt("s1", "must not dispatch"),
          /DELIVERY_UNKNOWN/,
        );
        assert.equal(await readFile(trace, "utf8"), before);
        assert.equal(client.activitySnapshot().uncertainSessions, 1);
        assert.equal(client.sessions.size, 0);
        if (method === "load")
          assert.throws(
            () => service.deleteSession(client.historySessionId("s1")),
            /unknown/i,
            "an unconfirmed load source must survive until its exact owner is explicitly resolved",
          );
      } finally {
        await service.close();
        hub.close();
        history.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}

for (const loadSession of [undefined, false, "true"] as const) {
  test(
    `ACP unsupported load capability ${JSON.stringify(loadSession)} rejects before dispatch or source allocation`,
    { timeout: 10_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "acp-load-capability-"));
      const hub = new EventHub(),
        history = new SessionDatabase(root);
      const service = createAcpService({
        hub,
        history,
        dataHome: root,
        env: { HOME: root, PATH: process.env.PATH },
      });
      const loadLog = join(root, "load-rpc.log");
      const capabilityFixture = fixture
        .replace(
          "agentCapabilities:{loadSession:true}",
          `agentCapabilities:${JSON.stringify(loadSession === undefined ? {} : { loadSession })}`,
        )
        .replace(
          "if(m.method==='session/new'||m.method==='session/load') return reply(m,{sessionId:'s1'});",
          `if(m.method==='session/new') return reply(m,{sessionId:'s1'}); if(m.method==='session/load') { require('node:fs').appendFileSync(${JSON.stringify(loadLog)},'LOAD'); return reply(m,{sessionId:'s1'}); }`,
        );
      try {
        const { client } = await service.connect({
          cwd: root,
          agent: {
            id: "fixture",
            name: "Fixture",
            command: process.execPath,
            args: ["-e", capabilityFixture, "--"],
          },
        });
        await client.newSession(root);
        const before = history.listSessions();
        await assert.rejects(
          client.loadSession("another-session", root),
          /NOT_SENT.*support.*load/i,
        );
        assert.deepEqual(history.listSessions(), before);
        assert.equal(client.activitySnapshot().uncertainSessions, 0);
        await assert.rejects(readFile(loadLog), { code: "ENOENT" });
        await client.prompt("s1", "original remains usable");
      } finally {
        await service.close();
        hub.close();
        history.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}

test(
  "official ACP v1 session/load may return an empty object; gateway projects its exact captured native target",
  { timeout: 10_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-load-empty-response-")),
      hub = new EventHub(),
      history = new SessionDatabase(root);
    const official = fixture.replace(
      "if(m.method==='session/new'||m.method==='session/load') return reply(m,{sessionId:'s1'});",
      "if(m.method==='session/new') return reply(m,{sessionId:'s1'}); if(m.method==='session/load') return reply(m,{});",
    );
    const service = createAcpService({
      hub,
      history,
      dataHome: root,
      env: { HOME: root, PATH: process.env.PATH },
    });
    try {
      const { client } = await service.connect({
        cwd: root,
        agent: {
          id: "fixture",
          name: "Fixture",
          command: process.execPath,
          args: ["-e", official, "--"],
        },
      });
      const loaded = (await client.loadSession("s1", root)) as {
        sessionId: string;
        historySessionId: string;
      };
      assert.equal(loaded.sessionId, "s1");
      assert.equal(loaded.historySessionId, client.historySessionId("s1"));
      await client.prompt("s1", "accepted native request");
      assert.equal(client.activitySnapshot().uncertainSessions, 0);
    } finally {
      await service.close();
      hub.close();
      history.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
