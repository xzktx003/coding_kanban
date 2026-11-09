// Presentation only. Keys identify already known surfaces; this module never
// resolves a thread, grants input authority, opens a native view or stops a task.
const MAX_BYTES = 32768,
  MAX_TABS = 128,
  MAX_GROUPS = 64,
  MAX_DEPTH = 16;
const fail = (code) =>
  Object.assign(new Error("Desktop pane layout unavailable"), { code });
const keyOK = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 160 &&
  !/[\x00-\x1f\x7f]/.test(value);
const idOK = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const groups = (node) =>
  node.type === "group"
    ? [node]
    : [...groups(node.first), ...groups(node.second)];
const map = (node, fn) => {
  if (node.type === "group") return fn(node);
  const first = map(node.first, fn),
    second = map(node.second, fn);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
};
const replace = (node, id, next) => {
  if (node.id === id) return next;
  if (node.type === "group") return node;
  const first = replace(node.first, id, next),
    second = replace(node.second, id, next);
  return first === node.first && second === node.second
    ? node
    : { ...node, first, second };
};
const prune = (node) => {
  if (node.type === "group")
    return node.keys.length || node.keepEmpty ? node : null;
  const first = prune(node.first),
    second = prune(node.second);
  return first && second
    ? first === node.first && second === node.second
      ? node
      : { ...node, first, second }
    : (first ?? second);
};
const freeze = (node) => {
  if (Object.isFrozen(node)) return node;
  if (node.type === "group") Object.freeze(node.keys);
  else {
    freeze(node.first);
    freeze(node.second);
  }
  return Object.freeze(node);
};
const exact = (value, required, optional = []) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key),
  );

function validate(saved) {
  if (
    !exact(saved, ["version", "tree", "activeGroupId"]) ||
    saved.version !== 1
  )
    throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
  const ids = new Set(),
    keys = new Set(),
    panes = [];
  const visit = (node, depth) => {
    if (!node || depth > MAX_DEPTH || !idOK(node.id) || ids.has(node.id))
      throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
    ids.add(node.id);
    if (node.type === "group") {
      if (
        !exact(node, ["type", "id", "keys", "selected"], ["keepEmpty"]) ||
        !Array.isArray(node.keys) ||
        (Object.hasOwn(node, "keepEmpty") && node.keepEmpty !== true) ||
        (node.keys.length
          ? !node.keys.includes(node.selected)
          : node.selected !== null)
      )
        throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
      for (const key of node.keys) {
        if (!keyOK(key) || keys.has(key) || keys.size >= MAX_TABS)
          throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
        keys.add(key);
      }
      panes.push(node);
      if (panes.length > MAX_GROUPS)
        throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
      return;
    }
    if (
      !exact(node, ["type", "id", "direction", "ratio", "first", "second"]) ||
      node.type !== "split" ||
      !["horizontal", "vertical"].includes(node.direction) ||
      !Number.isFinite(node.ratio) ||
      node.ratio < 15 ||
      node.ratio > 85
    )
      throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
    visit(node.first, depth + 1);
    visit(node.second, depth + 1);
  };
  visit(saved.tree, 0);
  if (!panes.some((pane) => pane.id === saved.activeGroupId))
    throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
  return { ids, panes };
}

/** Independent device layout. Native identities and drafts are owned elsewhere. */
export function createDesktopPaneLayout({
  idFactory = () => globalThis.crypto.randomUUID(),
  saved,
} = {}) {
  if (typeof idFactory !== "function")
    throw fail("DESKTOP_LAYOUT_INVALID_CONFIG");
  const allocated = new Set(),
    listeners = new Set();
  const nextId = () => {
    for (let attempt = 0; attempt < 256; attempt++) {
      const id = idFactory();
      if (!idOK(id)) throw fail("DESKTOP_LAYOUT_INVALID_CONFIG");
      if (!allocated.has(id)) {
        allocated.add(id);
        return id;
      }
    }
    throw fail("DESKTOP_LAYOUT_ID_EXHAUSTED");
  };
  const group = (keys = []) => ({
    type: "group",
    id: nextId(),
    keys,
    selected: keys[0] ?? null,
  });
  let restored;
  if (saved !== undefined) {
    if (
      typeof saved !== "string" ||
      saved.length > MAX_BYTES ||
      new TextEncoder().encode(saved).byteLength > MAX_BYTES
    )
      throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
    try {
      restored = JSON.parse(saved);
    } catch {
      throw fail("DESKTOP_LAYOUT_INVALID_SAVED_STATE");
    }
    for (const id of validate(restored).ids) allocated.add(id);
  }
  const tree = restored?.tree ?? group();
  let state = Object.freeze({
    version: 1,
    tree: freeze(tree),
    activeGroupId: restored?.activeGroupId ?? tree.id,
    revision: 0,
  });
  const serialize = (value) =>
    JSON.stringify({
      version: 1,
      tree: value.tree,
      activeGroupId: value.activeGroupId,
    });
  const update = (tree, activeGroupId = state.activeGroupId) => {
    try {
      if (tree === state.tree && activeGroupId === state.activeGroupId)
        return false;
      if (!groups(tree).some((pane) => pane.id === activeGroupId))
        activeGroupId = groups(tree)[0].id;
      const next = {
        version: 1,
        tree,
        activeGroupId,
        revision: state.revision + 1,
      };
      try {
        validate({ version: 1, tree, activeGroupId });
      } catch {
        throw fail("DESKTOP_LAYOUT_LIMIT");
      }
      const body = serialize(next);
      if (
        body.length > MAX_BYTES ||
        new TextEncoder().encode(body).byteLength > MAX_BYTES
      )
        throw fail("DESKTOP_LAYOUT_LIMIT");
      if (body === serialize(state)) return false;
      state = Object.freeze({ ...next, tree: freeze(tree) });
    } finally {
      // Retain current IDs only, rather than every split ever dragged during a
      // long-lived page. The idFactory must generate fresh document-local IDs.
      allocated.clear();
      for (const id of validate({
        version: 1,
        tree: state.tree,
        activeGroupId: state.activeGroupId,
      }).ids)
        allocated.add(id);
    }
    for (const listener of [...listeners]) listener();
    return true;
  };
  const focus = (key) => {
    const owner = groups(state.tree).find((pane) => pane.keys.includes(key));
    if (!owner) return false;
    return update(
      map(state.tree, (pane) =>
        pane.id === owner.id && pane.selected !== key
          ? { ...pane, selected: key }
          : pane,
      ),
      owner.id,
    );
  };
  const remove = (node, key) =>
    map(node, (pane) => {
      const index = pane.keys.indexOf(key);
      if (index < 0) return pane;
      const keys = pane.keys.filter((value) => value !== key);
      return {
        ...pane,
        keys,
        selected:
          pane.selected === key
            ? (keys[Math.min(index, keys.length - 1)] ?? null)
            : pane.selected,
      };
    });
  return Object.freeze({
    getSnapshot: () => state,
    serialize: () => serialize(state),
    subscribe(listener) {
      if (typeof listener !== "function")
        throw fail("DESKTOP_LAYOUT_INVALID_CONFIG");
      const wrapped = () => listener();
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    open(key, groupId = state.activeGroupId) {
      if (!keyOK(key)) throw fail("DESKTOP_LAYOUT_INVALID_KEY");
      if (groups(state.tree).some((pane) => pane.keys.includes(key)))
        return focus(key);
      if (!groups(state.tree).some((pane) => pane.id === groupId)) return false;
      return update(
        map(state.tree, (pane) => {
          if (pane.id !== groupId) return pane;
          const { keepEmpty: _keepEmpty, ...filled } = pane;
          return { ...filled, keys: [...pane.keys, key], selected: key };
        }),
        groupId,
      );
    },
    focus,
    focusGroup(id) {
      return groups(state.tree).some((pane) => pane.id === id)
        ? update(state.tree, id)
        : false;
    },
    place(key, targetId, edge, beforeKey) {
      if (!["left", "right", "top", "bottom", "center"].includes(edge))
        return false;
      const panes = groups(state.tree),
        owner = panes.find((pane) => pane.keys.includes(key));
      if (!owner || !panes.some((pane) => pane.id === targetId)) return false;
      let tree = remove(state.tree, key);
      const current = groups(tree).find((pane) => pane.id === targetId);
      let focused;
      if (edge === "center") {
        const keys = [...current.keys],
          index = beforeKey ? keys.indexOf(beforeKey) : -1;
        keys.splice(index < 0 ? keys.length : index, 0, key);
        const { keepEmpty: _keepEmpty, ...filled } = current;
        focused = { ...filled, keys, selected: key };
        tree = replace(tree, targetId, focused);
      } else {
        focused = group([key]);
        const original =
          owner.id === targetId && !current.keys.length
            ? { ...current, keepEmpty: true }
            : current;
        const leading = edge === "left" || edge === "top";
        tree = replace(tree, targetId, {
          type: "split",
          id: nextId(),
          direction:
            edge === "left" || edge === "right" ? "horizontal" : "vertical",
          ratio: 50,
          first: leading ? focused : original,
          second: leading ? original : focused,
        });
      }
      return update(prune(tree) ?? focused, focused.id);
    },
    mergeGroups(sourceId, targetId) {
      if (sourceId === targetId) return false;
      const panes = groups(state.tree),
        source = panes.find((pane) => pane.id === sourceId),
        target = panes.find((pane) => pane.id === targetId);
      if (!source || !target) return false;
      const keys = [...target.keys, ...source.keys],
        activeSource = state.activeGroupId === sourceId,
        selected = activeSource
          ? (source.selected ?? target.selected)
          : (target.selected ?? source.selected),
        merged = {
          type: "group",
          id: targetId,
          keys,
          selected,
          ...(!keys.length ? { keepEmpty: true } : {}),
        };
      // Merge once rather than replaying one move per tab. Observers never see
      // a partially merged target or gain authority for an intermediate tab.
      const tree = map(state.tree, (pane) =>
        pane.id === sourceId
          ? { type: "group", id: sourceId, keys: [], selected: null }
          : pane.id === targetId
            ? merged
            : pane,
      );
      return update(
        prune(tree) ?? merged,
        activeSource ? targetId : state.activeGroupId,
      );
    },
    close(key) {
      if (!groups(state.tree).some((pane) => pane.keys.includes(key)))
        return false;
      return update(prune(remove(state.tree, key)) ?? group());
    },
    closeGroup(id) {
      const pane = groups(state.tree).find((item) => item.id === id);
      if (!pane || (state.tree === pane && !pane.keys.length)) return false;
      // One presentation transaction removes the whole pane. No per-tab
      // intermediate selection is published and no native task is touched.
      const tree = map(state.tree, (item) => item.id === id
        ? { type: "group", id, keys: [], selected: null }
        : item);
      return update(prune(tree) ?? group());
    },
    closeEmptyGroup(id) {
      if (state.tree.type === "group") return false;
      if (
        !groups(state.tree).some((pane) => pane.id === id && !pane.keys.length)
      )
        return false;
      const tree = map(state.tree, (pane) => {
        if (pane.id !== id) return pane;
        const { keepEmpty: _keepEmpty, ...closed } = pane;
        return closed;
      });
      return update(prune(tree) ?? group());
    },
    resize(id, ratio) {
      if (!Number.isFinite(ratio)) return false;
      const visit = (node) => {
        if (node.type === "group") return node;
        const first = visit(node.first),
          second = visit(node.second),
          next =
            node.id === id ? Math.max(15, Math.min(85, ratio)) : node.ratio;
        return first === node.first &&
          second === node.second &&
          next === node.ratio
          ? node
          : { ...node, first, second, ratio: next };
      };
      return update(visit(state.tree));
    },
    reconcile(allowedKeys) {
      if (
        !Array.isArray(allowedKeys) ||
        allowedKeys.length > MAX_TABS ||
        allowedKeys.some((key) => !keyOK(key))
      )
        throw fail("DESKTOP_LAYOUT_INVALID_KEY");
      const allowed = new Set(allowedKeys);
      let tree = state.tree;
      for (const key of groups(tree).flatMap((pane) => pane.keys))
        if (!allowed.has(key)) tree = remove(tree, key);
      if (tree === state.tree) return false;
      return update(prune(tree) ?? group());
    },
  });
}
