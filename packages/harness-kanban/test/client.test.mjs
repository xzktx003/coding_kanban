import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function load(react = {}) {
  let plugin;
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    URL,
    window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(() => react); } } },
  });
  return plugin;
}

test('only stores a credential-free Kanban origin, with HTTPS for LAN targets', () => {
  const { normalizeOrigin } = load();
  assert.equal(normalizeOrigin(' https://kanban.example:8443/ '), 'https://kanban.example:8443');
  assert.equal(normalizeOrigin('http://127.0.0.1:8888'), 'http://127.0.0.1:8888');
  assert.equal(normalizeOrigin('http://[::1]:8888/'), 'http://[::1]:8888');
  for (const value of ['javascript:alert(1)', '//kanban.example', 'http://kanban.example',
    'https://user:secret@kanban.example', 'https://kanban.example/?token=secret',
    'https://kanban.example/#token', 'https://kanban.example/kanban', '',
    'http://localhost.evil.example', 'https://kanban.example\\@evil.example']) {
    assert.throws(() => normalizeOrigin(value), undefined, value);
  }
});

test('connection persistence is versioned and never crashes when storage is unavailable', () => {
  const { createWorkspaceStore } = load();
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = createWorkspaceStore(storage);
  assert.equal(store.getSnapshot().url, '');
  store.connect('https://kanban.example:8443/');
  assert.equal(createWorkspaceStore(storage).getSnapshot().url, 'https://kanban.example:8443');
  assert.equal(values.size, 1);
  const saved = JSON.parse([...values.values()][0]);
  assert.deepEqual(Object.keys(saved).sort(), ['url', 'version']);
  const unavailable = createWorkspaceStore({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  unavailable.connect('https://kanban.example');
  assert.equal(unavailable.getSnapshot().url, 'https://kanban.example');
  assert.ok(unavailable.getSnapshot().warning);
});

test('invalid or future stored data is ignored without deleting user storage', () => {
  const { createWorkspaceStore } = load();
  for (const value of ['broken', '{"version":2,"url":"https://kanban.example"}', '{"version":1,"url":"http://evil.example"}']) {
    const store = createWorkspaceStore({ getItem: () => value });
    assert.equal(store.getSnapshot().url, '');
  }
});

test('navigation keeps the same frame generation; only explicit reload or URL change replaces it', () => {
  const { createWorkspaceStore } = load();
  const store = createWorkspaceStore();
  let notices = 0;
  store.subscribe(() => notices++);
  store.connect('https://kanban.example');
  const generation = store.getSnapshot().generation;
  store.activate(true);
  store.activate(false);
  store.activate(true);
  assert.equal(store.getSnapshot().opened, true);
  assert.equal(store.getSnapshot().generation, generation);
  const before = notices;
  store.activate(true);
  assert.equal(notices, before, 'same snapshot must not notify');
  store.connect('https://kanban.example/');
  assert.equal(store.getSnapshot().generation, generation);
  store.reload();
  assert.equal(store.getSnapshot().generation, generation + 1);
  assert.throws(() => store.connect('http://bad.example'));
  assert.equal(store.getSnapshot().url, 'https://kanban.example');
});

test('iframe requires a secure ancestor and cannot point back at Harness itself', () => {
  const { embeddingIssue } = load();
  assert.ok(embeddingIssue('https://kanban.example', { origin: 'http://harness.example', secure: false }));
  assert.ok(embeddingIssue('https://harness.example', { origin: 'https://harness.example', secure: true }));
  assert.equal(embeddingIssue('https://kanban.example', { origin: 'https://harness.example', secure: true }), '');
});

test('independent launcher can open over replacement shells without navigating their session', () => {
  const { createWorkspaceStore } = load();
  const store = createWorkspaceStore();
  store.setExpanded(true);
  assert.equal(store.getSnapshot().expanded, true);
  assert.equal(store.getSnapshot().opened, true);
  store.setExpanded(false);
  assert.equal(store.getSnapshot().expanded, false);
  assert.equal(store.getSnapshot().opened, true);
});

test('plugin adds its own persistent overlay and main entry without taking an occupied shell seat', () => {
  const plugin = load();
  const rows = [];
  const ctx = {
    layout: {},
    inject: (_names, callback) => callback(ctx),
    slots: { inject: (_name, callback) => callback(), register: (spec, component) => rows.push({ spec, component }) },
  };
  plugin.apply(ctx);
  assert.deepEqual(rows.map(row => row.spec.name).sort(), ['main', 'settings.plugins.tab', 'shell.overlay', 'sidebar.panellist']);
  assert.equal(rows.find(row => row.spec.name === 'main').spec.key, 'kanban');
  assert.equal(rows.find(row => row.spec.name === 'sidebar.panellist').spec.id, 'kanban');
});
