/** Generated from original VSIX mcp-tool-activity-label-ed4208299cd0.js.
 * Pure connector activity metadata only: no React UI, widgets, requests or host actions.
 * Source schema validation, argument selection, preview limits and result count rules are retained.
 * Regenerator: .dev-runtime/session-render-alignment/tools/build-mcp-registry.mjs.
 */
import { z as schemaLibrary } from "zod";
import { nativeToolLabels } from "./nativeToolLabels.ts";
const e = (callback) => {
  let initialized = false;
  return () => {
    if (!initialized) {
      initialized = true;
      callback();
    }
  };
};
const d = () => {},
  c = () => {},
  me = () => {},
  $e = () => {};
const t = schemaLibrary.enum,
  r = schemaLibrary.array,
  i = schemaLibrary.null,
  s = schemaLibrary.custom,
  p = schemaLibrary.string,
  m = schemaLibrary.unknown,
  te = schemaLibrary.union,
  g = schemaLibrary.boolean,
  ne = schemaLibrary.literal,
  _ = schemaLibrary.number,
  ie = schemaLibrary.record;
function f(shape) {
  const schema = schemaLibrary.object(shape);
  schema.loose = schema.passthrough.bind(schema);
  return schema;
}
const h = (messages) =>
  Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      { ...value, defaultMessage: nativeToolLabels[value.id]?.[0] ?? "" },
    ]),
  );
const driveFields = [
  "documentUrl",
  "document_url",
  "fileUrl",
  "file_url",
  "presentationUrl",
  "presentation_url",
  "spreadsheetUrl",
  "spreadsheet_url",
  "display_url",
  "url",
  "webViewLink",
  "web_view_link",
  "title",
  "display_title",
  "name",
  "mimeType",
  "mime_type",
];
const driveSchema = f({
  ...Object.fromEntries(
    driveFields.map((key) => [key, p().optional().catch(undefined)]),
  ),
  properties: f({ title: p().optional().catch(undefined) })
    .optional()
    .catch(undefined),
}).loose();
function Ze(value) {
  if (value == null) return null;
  const parsed = driveSchema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    urls: [
      ...new Set(
        driveFields
          .slice(0, 12)
          .map((key) => data[key])
          .filter((value) => value != null),
      ),
    ],
    title:
      data.title?.trim() ||
      data.display_title?.trim() ||
      data.name?.trim() ||
      data.properties?.title?.trim() ||
      null,
    mimeType: data.mimeType?.trim() || data.mime_type?.trim() || null,
  };
}

function u({ protocol, hostname } = {}) {
  return schemaLibrary
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        (!protocol || protocol.test(url.protocol.slice(0, -1))) &&
        (!hostname || hostname.test(url.hostname))
      );
    });
}
const acronyms = new Set([
  "GH",
  "IA",
  "MCP",
  "API",
  "CI",
  "CLI",
  "LLM",
  "PDF",
  "PR",
  "RCS",
  "UI",
  "URL",
  "SQL",
  "TW",
  "GPU",
  "CPU",
]);
const brands = new Map([
  ["openai", "OpenAI"],
  ["openaideveloperdocs", "OpenAI Developer Docs"],
  ["openapi", "OpenAPI"],
  ["github", "GitHub"],
  ["imessage", "iMessage"],
  ["pagerduty", "PagerDuty"],
  ["datadog", "DataDog"],
  ["sharepoint", "SharePoint"],
  ["sqlite", "SQLite"],
  ["fastapi", "FastAPI"],
]);
function de(value, { style = "title" } = {}) {
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const upper = word.toUpperCase();
      if (acronyms.has(upper)) return upper;
      const singular = word.slice(0, -1).toUpperCase();
      if (word.toLowerCase().endsWith("s") && acronyms.has(singular))
        return singular + "s";
      const lower = word.toLowerCase();
      return (
        brands.get(lower) ??
        (style === "title" &&
        index > 0 &&
        ["and", "or", "to", "up", "with"].includes(lower)
          ? lower
          : style === "sentence" && index > 0
            ? lower
            : lower[0].toUpperCase() + lower.slice(1))
      );
    })
    .join(" ");
}
function Vt({ countKeys: e = [], preferredKeys: t, toolResult: n }) {
  let r = Ht(n);
  return r == null
    ? null
    : Wt({ countKeys: [...e, ...Gt], preferredKeys: t, structuredContent: r });
}
function Ht(e) {
  if (typeof e != `object` || !e) return null;
  let t = e;
  return t.type === `success` ? (t.structuredContent ?? Ut(t.raw)) : null;
}
function Ut(e) {
  return typeof e != `object` || !e ? null : (e.structuredContent ?? null);
}
function Wt({ countKeys: e, preferredKeys: t, structuredContent: n }) {
  if (Array.isArray(n)) return n.length;
  if (typeof n != `object` || !n) return null;
  let r = n;
  for (let e of t) {
    let t = r[e];
    if (Array.isArray(t)) return t.length;
  }
  for (let t of e) {
    let e = r[t];
    if (typeof e == `number` && Number.isInteger(e) && e >= 0) return e;
  }
  let i = Object.values(r).filter(Array.isArray);
  return i.length === 1 ? i[0].length : null;
}
var Gt;
function Kt() {
  return (Kt = e(() => {
    Gt = [`count`, `total`, `total_count`, `totalCount`];
  }))();
}
function C({ appRegistryKey: e, toolArgumentsSchema: t, tools: n }) {
  return ({
    completed: r,
    intl: i,
    matchingApp: a,
    toolArguments: o,
    toolResult: s,
    toolKey: c,
  }) => {
    if (!Qt(a, e)) return null;
    let l = n[c];
    if (l == null) return null;
    let u = Zt({
      intl: i,
      toolArguments: o,
      toolArgumentsSchema: t,
      toolResult: s,
    });
    return r ? l.completed(u) : l.active(u);
  };
}
function qt({ toolArgumentsSchema: e, tools: t }) {
  return ({ toolArguments: n, toolKey: r }) => {
    let i = t[r]?.approval;
    if (i == null) return null;
    let a = e.safeParse(n);
    return i(a.success ? a.data : null);
  };
}
function w(e, t) {
  return {
    active: ({ intl: t }) => t.formatMessage(e().active),
    completed: ({ intl: t }) => t.formatMessage(e().completed),
    approval: t,
  };
}
function Jt({ getMessages: e, getValues: t, approval: n }) {
  let r = (n, r) => {
    let i = t(n),
      a = e();
    return i == null
      ? n.intl.formatMessage(a.withoutContext[r])
      : n.intl.formatMessage(a.withContext[r], i);
  };
  return {
    active: (e) => r(e, `active`),
    completed: (e) => r(e, `completed`),
    approval: n,
  };
}
function T({
  getItemName: e,
  getMessages: t,
  maxPreviewLength: n,
  approval: r,
}) {
  return E({
    getMessages: t,
    getValue: e,
    maxPreviewLength: n,
    valueName: `itemName`,
    approval: r,
  });
}
function E({
  getMessages: e,
  getValue: t,
  maxPreviewLength: n,
  valueName: r,
  approval: i,
}) {
  return Jt({
    getMessages: e,
    getValues: ({ hasInvocationContext: e, toolArguments: i }) => {
      if (!e || i == null) return null;
      let a = D({ maxLength: n, value: t(i) });
      return a == null ? null : { [r]: a };
    },
    approval: i,
  });
}
function Yt({ getMessages: e, preferredKeys: t }) {
  return {
    active: (t) => {
      let n = e();
      return t.hasInvocationContext
        ? t.intl.formatMessage(n.withContext.active)
        : t.intl.formatMessage(n.withoutContext.active);
    },
    completed: (n) => {
      let r = e();
      if (!n.hasInvocationContext)
        return n.intl.formatMessage(r.withoutContext.completed);
      let i = Vt({ preferredKeys: t, toolResult: n.toolResult });
      return i == null
        ? n.intl.formatMessage(r.withContext.completed)
        : n.intl.formatMessage(r.completedCount, { count: i });
    },
  };
}
function Xt({
  getMessages: e,
  getQuery: t,
  maxPreviewLength: n,
  preferredKeys: r,
  shouldIncludeResultCount: i,
}) {
  return {
    active: E({
      getMessages: e,
      getValue: t,
      maxPreviewLength: n,
      valueName: `query`,
    }).active,
    completed: (a) => {
      let o = e();
      if (!a.hasInvocationContext || a.toolArguments == null)
        return a.intl.formatMessage(o.withoutContext.completed);
      let s = D({ maxLength: n, value: t(a.toolArguments) });
      if (s != null)
        return a.intl.formatMessage(o.withContext.completed, { query: s });
      if (i(a.toolArguments)) {
        let e = Vt({ preferredKeys: r, toolResult: a.toolResult });
        if (e != null)
          return a.intl.formatMessage(o.completedCount, { count: e });
      }
      return a.intl.formatMessage(o.withoutContext.completed);
    },
  };
}
function D({ maxLength: e, value: t }) {
  if (t == null) return null;
  let n = t.replace(/\s+/g, ` `).trim();
  return n.length === 0
    ? null
    : n.length <= e
      ? n
      : `${n.slice(0, e - 1).trimEnd()}…`;
}
function Zt({
  intl: e,
  toolArguments: t,
  toolArgumentsSchema: n,
  toolResult: r,
}) {
  let i = null,
    a = !1,
    o = () => {
      if (!a) {
        let e = n.safeParse(t);
        ((i = e.success ? e.data : null), (a = !0));
      }
      return i;
    };
  return {
    get hasInvocationContext() {
      return o() != null;
    },
    intl: e,
    get toolArguments() {
      return o();
    },
    toolResult: r,
  };
}
function Qt(e, t) {
  return (
    e != null &&
    [e.name, e.id, ...(e.pluginDisplayNames ?? [])].some((e) =>
      e.trim().toLowerCase().includes(t),
    )
  );
}
function O() {
  return (O = e(() => {
    Kt();
  }))();
}
function $t(e) {
  if (
    e.connector_id !== `browser-use` ||
    e.tool_name !== `allow_browser_control` ||
    e.browser_use_elicitation_id !== `browser-use-first-time-control`
  )
    return null;
  let t = p().trim().min(1).safeParse(e.browser_use_browser_name);
  return t.success
    ? {
        descriptor: k.namedControlConsentTitle,
        description: k.controlConsentDescription,
        approveLabel: k.controlConsentAllow,
        values: { browserName: t.data },
      }
    : {
        descriptor: k.controlConsentTitle,
        description: k.controlConsentDescription,
        approveLabel: k.controlConsentAllow,
      };
}
function en(e, t) {
  return e
    ? t.formatMessage(k.run_code_unsafe_completed)
    : t.formatMessage(k.run_code_unsafe_active);
}
var tn, nn, k;
function rn() {
  return (rn = e(() => {
    (d(),
      c(),
      O(),
      (tn = `browser`),
      (nn = C({
        appRegistryKey: tn,
        toolArgumentsSchema: f({}).strip(),
        tools: {
          run_code_unsafe: w(() => ({
            active: k.run_code_unsafe_active,
            completed: k.run_code_unsafe_completed,
          })),
        },
      })),
      (k = h({
        controlConsentAllow: {
          id: `browser.controlConsent.allow`,
        },
        namedControlConsentTitle: {
          id: `browser.controlConsent.namedBrowserTitle`,
        },
        controlConsentTitle: {
          id: `browser.controlConsent.genericBrowserTitle`,
        },
        controlConsentDescription: {
          id: `browser.controlConsent.description`,
        },
        run_code_unsafe_active: {
          id: `localConversation.mcpToolActivity.browser.run_code_unsafe.active`,
        },
        run_code_unsafe_completed: {
          id: `localConversation.mcpToolActivity.browser.run_code_unsafe.completed`,
        },
      })));
  }))();
}
function an(e) {
  let t = un(e?.fileName),
    n = e?.editorType;
  return t == null && n == null
    ? { descriptor: A.create_new_file_approval }
    : {
        descriptor: A.create_new_file_approvalWithContext,
        values: {
          editorType: n ?? `unknown`,
          fileName: t ?? ``,
          hasFileName: t == null ? `no` : `yes`,
        },
      };
}
function on(e, { detail: t, fallback: n, withContext: r }) {
  let i = un(e),
    a = un(t);
  return i == null && a == null
    ? { descriptor: n }
    : {
        descriptor: r,
        values: {
          detail: a ?? ``,
          hasDetail: a == null ? `no` : `yes`,
          hasItemName: i == null ? `no` : `yes`,
          itemName: i ?? ``,
        },
      };
}
function sn(e, { fallback: t, withContext: n }) {
  let r = un(e?.componentName),
    i = un(e?.label),
    a = un(e?.source);
  return r == null && i == null && a == null
    ? { descriptor: t }
    : {
        descriptor: n,
        values: {
          componentName: r ?? ``,
          hasComponentName: r == null ? `no` : `yes`,
          hasLabel: i == null ? `no` : `yes`,
          hasSource: a == null ? `no` : `yes`,
          label: i ?? ``,
          source: a ?? ``,
        },
      };
}
function cn(e) {
  let t = e?.mappings;
  if (t == null || t.length === 0)
    return { descriptor: A.send_code_connect_mappings_approval };
  if (t.length === 1)
    return sn(t[0] ?? null, {
      fallback: A.send_code_connect_mappings_approval,
      withContext: A.send_code_connect_mappings_approvalWithSingleMapping,
    });
  let n = un(
    t
      .map(({ componentName: e }) => e)
      .filter((e) => e != null)
      .join(`, `),
  );
  return {
    descriptor: A.send_code_connect_mappings_approvalWithContext,
    values: {
      componentNames: n ?? ``,
      count: t.length,
      hasComponentNames: n == null ? `no` : `yes`,
    },
  };
}
function ln(e) {
  return e?.count == null
    ? { descriptor: A.upload_assets_approval }
    : {
        descriptor: A.upload_assets_approvalWithContext,
        values: {
          count: e.count,
          hasScaleMode: e.scaleMode == null ? `no` : `yes`,
          scaleMode: e.scaleMode ?? `unknown`,
        },
      };
}
function un(e) {
  return D({ maxLength: mn, value: e });
}
function dn({ clientFrameworks: e, clientLanguages: t }) {
  let n = fn(e);
  if (n.length > 0) return n.join(`, `);
  let r = fn(t);
  return r.length > 0 ? r.join(`, `) : null;
}
function fn(e) {
  return e == null
    ? []
    : e
        .split(`,`)
        .map((e) => e.trim())
        .filter((e) => e.length > 0 && e.toLowerCase() !== `unknown`)
        .map((e) => hn.get(e.toLowerCase()) ?? de(e))
        .filter((e, t, n) => n.indexOf(e) === t);
}
var pn, mn, hn, gn, _n, vn, yn, bn, A;
function xn() {
  return (xn = e(() => {
    (me(),
      d(),
      c(),
      O(),
      (pn = `figma`),
      (mn = 40),
      (hn = new Map([
        [`angular`, `Angular`],
        [`css`, `CSS`],
        [`django`, `Django`],
        [`html`, `HTML`],
        [`javascript`, `JavaScript`],
        [`next.js`, `Next.js`],
        [`nextjs`, `Next.js`],
        [`react`, `React`],
        [`svelte`, `Svelte`],
        [`typescript`, `TypeScript`],
        [`vue`, `Vue`],
      ])),
      (gn = f({
        componentName: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        label: p()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .catch(void 0),
        source: p()
          .trim()
          .min(1)
          .max(1e3)
          .optional()
          .catch(void 0),
      }).strip()),
      (_n = f({
        clientFrameworks: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        clientLanguages: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        componentName: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        count: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        description: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        editorType: t([`design`, `figjam`, `slides`])
          .optional()
          .catch(void 0),
        fileName: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        label: p()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .catch(void 0),
        mappings: r(gn)
          .optional()
          .catch(void 0),
        name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        scaleMode: t([`FILL`, `FIT`, `TILE`])
          .optional()
          .catch(void 0),
        source: p()
          .trim()
          .min(1)
          .max(1e3)
          .optional()
          .catch(void 0),
        title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        userIntent: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
      }).strip()),
      (vn = {
        add_code_connect_map: w(
          () => ({
            active: A.add_code_connect_map_active,
            completed: A.add_code_connect_map_completed,
          }),
          (e) =>
            sn(e, {
              fallback: A.add_code_connect_map_approval,
              withContext: A.add_code_connect_map_approvalWithContext,
            }),
        ),
        create_new_file: T({
          getItemName: (e) => e.fileName,
          getMessages: () => ({
            withoutContext: {
              active: A.create_new_file_active,
              completed: A.create_new_file_completed,
            },
            withContext: {
              active: A.create_new_file_activeWithContext,
              completed: A.create_new_file_completedWithContext,
            },
          }),
          maxPreviewLength: mn,
          approval: an,
        }),
        download_assets: w(() => ({
          active: A.download_assets_active,
          completed: A.download_assets_completed,
        })),
        generate_deck: w(
          () => ({
            active: A.generate_deck_active,
            completed: A.generate_deck_completed,
          }),
          (e) =>
            on(e?.title, {
              detail: e?.description ?? e?.userIntent,
              fallback: A.generate_deck_approval,
              withContext: A.generate_deck_approvalWithContext,
            }),
        ),
        generate_diagram: T({
          getItemName: (e) => e.name ?? e.userIntent,
          getMessages: () => ({
            withoutContext: {
              active: A.generate_diagram_active,
              completed: A.generate_diagram_completed,
            },
            withContext: {
              active: A.generate_diagram_activeWithContext,
              completed: A.generate_diagram_completedWithContext,
            },
          }),
          maxPreviewLength: mn,
          approval: (e) =>
            on(e?.name, {
              detail: e?.userIntent,
              fallback: A.generate_diagram_approval,
              withContext: A.generate_diagram_approvalWithContext,
            }),
        }),
        generate_figma_design: w(
          () => ({
            active: A.generate_figma_design_active,
            completed: A.generate_figma_design_completed,
          }),
          () => ({ descriptor: A.generate_figma_design_approval }),
        ),
        get_code_connect_map: w(() => ({
          active: A.get_code_connect_map_active,
          completed: A.get_code_connect_map_completed,
        })),
        get_code_connect_suggestions: w(() => ({
          active: A.get_code_connect_suggestions_active,
          completed: A.get_code_connect_suggestions_completed,
        })),
        get_context_for_code_connect: w(() => ({
          active: A.get_context_for_code_connect_active,
          completed: A.get_context_for_code_connect_completed,
        })),
        get_design_context: Jt({
          getMessages: () => ({
            withoutContext: {
              active: A.get_design_context_active,
              completed: A.get_design_context_completed,
            },
            withContext: {
              active: A.get_design_context_activeWithContext,
              completed: A.get_design_context_completedWithContext,
            },
          }),
          getValues: ({ hasInvocationContext: e, toolArguments: t }) => {
            if (!e || t == null) return null;
            let n = dn(t);
            return n == null ? null : { target: n };
          },
        }),
        get_figjam: w(() => ({
          active: A.get_figjam_active,
          completed: A.get_figjam_completed,
        })),
        get_libraries: w(() => ({
          active: A.get_libraries_active,
          completed: A.get_libraries_completed,
        })),
        get_metadata: w(() => ({
          active: A.get_metadata_active,
          completed: A.get_metadata_completed,
        })),
        get_motion_context: w(() => ({
          active: A.get_motion_context_active,
          completed: A.get_motion_context_completed,
        })),
        get_screenshot: w(() => ({
          active: A.get_screenshot_active,
          completed: A.get_screenshot_completed,
        })),
        get_variable_defs: w(() => ({
          active: A.get_variable_defs_active,
          completed: A.get_variable_defs_completed,
        })),
        search_design_system: E({
          getMessages: () => ({
            withoutContext: {
              active: A.search_design_system_active,
              completed: A.search_design_system_completed,
            },
            withContext: {
              active: A.search_design_system_activeWithQuery,
              completed: A.search_design_system_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: mn,
          valueName: `query`,
        }),
        send_code_connect_mappings: w(
          () => ({
            active: A.send_code_connect_mappings_active,
            completed: A.send_code_connect_mappings_completed,
          }),
          cn,
        ),
        upload_assets: w(
          () => ({
            active: A.upload_assets_active,
            completed: A.upload_assets_completed,
          }),
          ln,
        ),
        use_figma: w(
          () => ({
            active: A.use_figma_active,
            completed: A.use_figma_completed,
          }),
          (e) =>
            on(e?.description, {
              fallback: A.use_figma_approval,
              withContext: A.use_figma_approvalWithContext,
            }),
        ),
      }),
      (yn = C({ appRegistryKey: pn, toolArgumentsSchema: _n, tools: vn })),
      (bn = qt({ toolArgumentsSchema: _n, tools: vn })),
      (A = h({
        add_code_connect_map_approval: {
          id: `localConversation.mcpToolApproval.figma.add_code_connect_map.fallback`,
        },
        add_code_connect_map_approvalWithContext: {
          id: `localConversation.mcpToolApproval.figma.add_code_connect_map.context`,
        },
        create_new_file_approval: {
          id: `localConversation.mcpToolApproval.figma.create_new_file.fallback`,
        },
        create_new_file_approvalWithContext: {
          id: `localConversation.mcpToolApproval.figma.create_new_file.context`,
        },
        generate_deck_approval: {
          id: `localConversation.mcpToolApproval.figma.generate_deck.fallback`,
        },
        generate_deck_approvalWithContext: {
          id: `localConversation.mcpToolApproval.figma.generate_deck.context`,
        },
        generate_diagram_approval: {
          id: `localConversation.mcpToolApproval.figma.generate_diagram.fallback`,
        },
        generate_diagram_approvalWithContext: {
          id: `localConversation.mcpToolApproval.figma.generate_diagram.context`,
        },
        generate_figma_design_approval: {
          id: `localConversation.mcpToolApproval.figma.generate_figma_design.fallback`,
        },
        send_code_connect_mappings_approval: {
          id: `localConversation.mcpToolApproval.figma.send_code_connect_mappings.fallback`,
        },
        send_code_connect_mappings_approvalWithContext: {
          id: `localConversation.mcpToolApproval.figma.send_code_connect_mappings.context`,
        },
        send_code_connect_mappings_approvalWithSingleMapping: {
          id: `localConversation.mcpToolApproval.figma.send_code_connect_mappings.singleMapping`,
        },
        upload_assets_approval: {
          id: `localConversation.mcpToolApproval.figma.upload_assets.fallback`,
        },
        upload_assets_approvalWithContext: {
          id: `localConversation.mcpToolApproval.figma.upload_assets.context`,
        },
        use_figma_approval: {
          id: `localConversation.mcpToolApproval.figma.use_figma.fallback`,
        },
        use_figma_approvalWithContext: {
          id: `localConversation.mcpToolApproval.figma.use_figma.context`,
        },
        add_code_connect_map_active: {
          id: `localConversation.mcpToolActivity.figma.add_code_connect_map.active`,
        },
        add_code_connect_map_completed: {
          id: `localConversation.mcpToolActivity.figma.add_code_connect_map.completed`,
        },
        create_new_file_active: {
          id: `localConversation.mcpToolActivity.figma.create_new_file.active`,
        },
        create_new_file_completed: {
          id: `localConversation.mcpToolActivity.figma.create_new_file.completed`,
        },
        download_assets_active: {
          id: `localConversation.mcpToolActivity.figma.download_assets.active`,
        },
        download_assets_completed: {
          id: `localConversation.mcpToolActivity.figma.download_assets.completed`,
        },
        generate_deck_active: {
          id: `localConversation.mcpToolActivity.figma.generate_deck.active`,
        },
        generate_deck_completed: {
          id: `localConversation.mcpToolActivity.figma.generate_deck.completed`,
        },
        generate_diagram_active: {
          id: `localConversation.mcpToolActivity.figma.generate_diagram.active`,
        },
        generate_diagram_completed: {
          id: `localConversation.mcpToolActivity.figma.generate_diagram.completed`,
        },
        generate_figma_design_active: {
          id: `localConversation.mcpToolActivity.figma.generate_figma_design.active`,
        },
        generate_figma_design_completed: {
          id: `localConversation.mcpToolActivity.figma.generate_figma_design.completed`,
        },
        get_code_connect_map_active: {
          id: `localConversation.mcpToolActivity.figma.get_code_connect_map.active`,
        },
        get_code_connect_map_completed: {
          id: `localConversation.mcpToolActivity.figma.get_code_connect_map.completed`,
        },
        get_code_connect_suggestions_active: {
          id: `localConversation.mcpToolActivity.figma.get_code_connect_suggestions.active`,
        },
        get_code_connect_suggestions_completed: {
          id: `localConversation.mcpToolActivity.figma.get_code_connect_suggestions.completed`,
        },
        get_context_for_code_connect_active: {
          id: `localConversation.mcpToolActivity.figma.get_context_for_code_connect.active`,
        },
        get_context_for_code_connect_completed: {
          id: `localConversation.mcpToolActivity.figma.get_context_for_code_connect.completed`,
        },
        get_design_context_active: {
          id: `localConversation.mcpToolActivity.figma.get_design_context.active`,
        },
        get_design_context_completed: {
          id: `localConversation.mcpToolActivity.figma.get_design_context.completed`,
        },
        get_figjam_active: {
          id: `localConversation.mcpToolActivity.figma.get_figjam.active`,
        },
        get_figjam_completed: {
          id: `localConversation.mcpToolActivity.figma.get_figjam.completed`,
        },
        get_libraries_active: {
          id: `localConversation.mcpToolActivity.figma.get_libraries.active`,
        },
        get_libraries_completed: {
          id: `localConversation.mcpToolActivity.figma.get_libraries.completed`,
        },
        get_metadata_active: {
          id: `localConversation.mcpToolActivity.figma.get_metadata.active`,
        },
        get_metadata_completed: {
          id: `localConversation.mcpToolActivity.figma.get_metadata.completed`,
        },
        get_motion_context_active: {
          id: `localConversation.mcpToolActivity.figma.get_motion_context.active`,
        },
        get_motion_context_completed: {
          id: `localConversation.mcpToolActivity.figma.get_motion_context.completed`,
        },
        get_screenshot_active: {
          id: `localConversation.mcpToolActivity.figma.get_screenshot.active`,
        },
        get_screenshot_completed: {
          id: `localConversation.mcpToolActivity.figma.get_screenshot.completed`,
        },
        get_variable_defs_active: {
          id: `localConversation.mcpToolActivity.figma.get_variable_defs.active`,
        },
        get_variable_defs_completed: {
          id: `localConversation.mcpToolActivity.figma.get_variable_defs.completed`,
        },
        search_design_system_active: {
          id: `localConversation.mcpToolActivity.figma.search_design_system.active`,
        },
        search_design_system_completed: {
          id: `localConversation.mcpToolActivity.figma.search_design_system.completed`,
        },
        send_code_connect_mappings_active: {
          id: `localConversation.mcpToolActivity.figma.send_code_connect_mappings.active`,
        },
        send_code_connect_mappings_completed: {
          id: `localConversation.mcpToolActivity.figma.send_code_connect_mappings.completed`,
        },
        upload_assets_active: {
          id: `localConversation.mcpToolActivity.figma.upload_assets.active`,
        },
        upload_assets_completed: {
          id: `localConversation.mcpToolActivity.figma.upload_assets.completed`,
        },
        use_figma_active: {
          id: `localConversation.mcpToolActivity.figma.use_figma.active`,
        },
        use_figma_completed: {
          id: `localConversation.mcpToolActivity.figma.use_figma.completed`,
        },
        create_new_file_activeWithContext: {
          id: `localConversation.mcpToolActivity.figma.create_new_file.activeWithContext`,
        },
        create_new_file_completedWithContext: {
          id: `localConversation.mcpToolActivity.figma.create_new_file.completedWithContext`,
        },
        generate_diagram_activeWithContext: {
          id: `localConversation.mcpToolActivity.figma.generate_diagram.activeWithContext`,
        },
        generate_diagram_completedWithContext: {
          id: `localConversation.mcpToolActivity.figma.generate_diagram.completedWithContext`,
        },
        get_design_context_activeWithContext: {
          id: `localConversation.mcpToolActivity.figma.get_design_context.activeWithContext`,
        },
        get_design_context_completedWithContext: {
          id: `localConversation.mcpToolActivity.figma.get_design_context.completedWithContext`,
        },
        search_design_system_activeWithQuery: {
          id: `localConversation.mcpToolActivity.figma.search_design_system.activeWithQuery`,
        },
        search_design_system_completedWithQuery: {
          id: `localConversation.mcpToolActivity.figma.search_design_system.completedWithQuery`,
        },
      })));
  }))();
}
function Sn({ toolArguments: e, toolKey: t }) {
  let n = In[t];
  if (n == null) return null;
  let r = Nn.safeParse(e);
  return { descriptor: n, values: Tn(r.success ? r.data : null) };
}
function j(e) {
  return D({ maxLength: An, value: e });
}
function Cn(e) {
  return j(e?.join(`, `));
}
function wn(e, t) {
  return e == null ? `unset` : t == null ? `clear` : `set`;
}
function Tn(e) {
  let t = Cn(e?.assignees),
    n = j(e?.base ?? e?.base_branch),
    r = j(e?.base_ref),
    i = j(e?.body),
    a = j(e?.branch),
    o = j(e?.branch_name),
    s = j(e?.comment),
    c = j(e?.head ?? e?.head_branch),
    l = j(e?.head_repo),
    u = j(e?.label),
    d = Cn(e?.labels),
    f = j(e?.message),
    ee = j(e?.path),
    p = j(e?.reaction?.replaceAll(`_`, ` `)),
    m = j(e?.repo_full_name ?? e?.repository_full_name),
    te = j(e?.review),
    h = Cn(e?.reviewers),
    g = Cn(e?.team_reviewers),
    ne = j(e?.title),
    _ =
      e?.action == null
        ? `other`
        : {
            APPROVE: `approve`,
            COMMENT: `comment`,
            REQUEST_CHANGES: `requestChanges`,
          }[e.action],
    re = `peopleAndTeams`;
  h == null ? (re = g == null ? `none` : `teams`) : (g ?? (re = `people`));
  let ie = `repositoryAndBranch`;
  return (
    l == null
      ? (ie = c == null ? `none` : `branch`)
      : (c ?? (ie = `repository`)),
    {
      assignees: t ?? ``,
      baseBranch: n ?? ``,
      baseRef: r ?? ``,
      body: i ?? ``,
      bodyChange: wn(e?.body, i),
      branch: a ?? ``,
      branchName: o ?? ``,
      comment: s ?? ``,
      draft: e?.draft === !0 ? `yes` : `no`,
      force: e?.force === !0 ? `yes` : `no`,
      hasAssignees: t == null ? `no` : `yes`,
      hasBaseBranch: n == null ? `no` : `yes`,
      hasBaseRef: r == null ? `no` : `yes`,
      hasBranch: a == null ? `no` : `yes`,
      hasBranchName: o == null ? `no` : `yes`,
      hasComment: s == null ? `no` : `yes`,
      hasHeadBranch: c == null ? `no` : `yes`,
      hasIssueNumber: e?.issue_number == null ? `no` : `yes`,
      hasLabel: u == null ? `no` : `yes`,
      hasLabels: d == null ? `no` : `yes`,
      hasMergeMethod: e?.merge_method == null ? `no` : `yes`,
      hasMilestone: e?.milestone == null ? `no` : `yes`,
      hasMessage: f == null ? `no` : `yes`,
      hasPath: ee == null ? `no` : `yes`,
      hasPullRequestNumber: e?.pr_number == null ? `no` : `yes`,
      hasReaction: p == null ? `no` : `yes`,
      hasRepository: m == null ? `no` : `yes`,
      hasReview: te == null ? `no` : `yes`,
      hasSourceIssueNumber: e?.issue == null ? `no` : `yes`,
      hasState: e?.state == null ? `no` : `yes`,
      hasTitle: ne == null ? `no` : `yes`,
      headBranch: c ?? ``,
      headRepository: l ?? ``,
      issueNumber: e?.issue_number ?? 0,
      label: u ?? ``,
      labels: d ?? ``,
      mergeMethod: e?.merge_method ?? `other`,
      milestone: e?.milestone ?? 0,
      message: f ?? ``,
      path: ee ?? ``,
      pullRequestNumber: e?.pr_number ?? 0,
      pullRequestSourceContext: ie,
      reaction: p ?? ``,
      repository: m ?? ``,
      review: te ?? ``,
      reviewAction: _,
      reviewerContext: re,
      reviewers: h ?? ``,
      sourceIssueNumber: e?.issue ?? 0,
      state: e?.state ?? `other`,
      teamReviewers: g ?? ``,
      title: ne ?? ``,
    }
  );
}
function M({ getMessages: e }) {
  return Jt({
    getMessages: e,
    getValues: ({ hasInvocationContext: e, toolArguments: t }) =>
      !e || t == null ? null : En(t),
  });
}
function En(e) {
  let t = e.repo_full_name ?? e.repository_full_name,
    n = e.pr_number ?? e.pull_number,
    r,
    i;
  if (n != null)
    ((r = t == null ? `pullRequest` : `repositoryPullRequest`), (i = n));
  else if (e.issue_number != null)
    ((r = t == null ? `issue` : `repositoryIssue`), (i = e.issue_number));
  else return null;
  return { contextType: r, number: `${i}`, repository: t ?? `` };
}
var Dn, N, On, kn, An, P, jn, Mn, Nn, Pn, Fn, F, In;
function Ln() {
  return (Ln = e(() => {
    (d(),
      c(),
      O(),
      (Dn = `github`),
      (N = 40),
      (On = p()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .catch(void 0)),
      (kn = f({
        issue_number: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        pr_number: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        pull_number: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        reaction: p()
          .trim()
          .min(1)
          .max(24)
          .regex(/^[a-z0-9_+-]+$/i)
          .optional()
          .catch(void 0),
        repo_full_name: On,
        repository_full_name: On,
        title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
      }).strip()),
      (An = 40),
      (P = p()
        .trim()
        .min(1)
        .optional()
        .catch(void 0)),
      (jn = p()
        .optional()
        .catch(void 0)),
      (Mn = r(p().trim().min(1).max(200))
        .max(20)
        .optional()
        .catch(void 0)),
      (Nn = f({
        action: t([`COMMENT`, `APPROVE`, `REQUEST_CHANGES`])
          .optional()
          .catch(void 0),
        assignees: Mn,
        base: P,
        base_branch: P,
        base_ref: P,
        body: jn,
        branch: P,
        branch_name: P,
        comment: jn,
        draft: g()
          .optional()
          .catch(void 0),
        force: g()
          .optional()
          .catch(void 0),
        head: P,
        head_branch: P,
        head_repo: P,
        issue: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        issue_number: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        label: P,
        labels: Mn,
        merge_method: t([`merge`, `squash`, `rebase`])
          .optional()
          .catch(void 0),
        milestone: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        message: jn,
        path: P,
        pr_number: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        reaction: p()
          .trim()
          .min(1)
          .max(24)
          .regex(/^[a-z0-9_+-]+$/i)
          .optional()
          .catch(void 0),
        repo_full_name: P,
        repository_full_name: P,
        review: jn,
        reviewers: Mn,
        state: t([`open`, `closed`])
          .optional()
          .catch(void 0),
        team_reviewers: Mn,
        title: P,
      }).strip()),
      (Pn = {
        add_comment_to_issue: w(() => ({
          active: F.add_comment_to_issue_active,
          completed: F.add_comment_to_issue_completed,
        })),
        add_issue_assignees: M({
          getMessages: () => ({
            withoutContext: {
              active: F.add_issue_assignees_active,
              completed: F.add_issue_assignees_completed,
            },
            withContext: {
              active: F.add_issue_assignees_activeWithContext,
              completed: F.add_issue_assignees_completedWithContext,
            },
          }),
        }),
        add_issue_labels: M({
          getMessages: () => ({
            withoutContext: {
              active: F.add_issue_labels_active,
              completed: F.add_issue_labels_completed,
            },
            withContext: {
              active: F.add_issue_labels_activeWithContext,
              completed: F.add_issue_labels_completedWithContext,
            },
          }),
        }),
        add_reaction_to_issue_comment: E({
          getMessages: () => ({
            withoutContext: {
              active: F.add_reaction_to_issue_comment_active,
              completed: F.add_reaction_to_issue_comment_completed,
            },
            withContext: {
              active: F.add_reaction_to_issue_comment_activeWithReactionOnly,
              completed:
                F.add_reaction_to_issue_comment_completedWithReactionOnly,
            },
          }),
          getValue: (e) => e.reaction?.replaceAll(`_`, ` `),
          maxPreviewLength: 24,
          valueName: `reaction`,
        }),
        add_reaction_to_pr: E({
          getMessages: () => ({
            withoutContext: {
              active: F.add_reaction_to_pr_active,
              completed: F.add_reaction_to_pr_completed,
            },
            withContext: {
              active: F.add_reaction_to_pr_activeWithReactionOnly,
              completed: F.add_reaction_to_pr_completedWithReactionOnly,
            },
          }),
          getValue: (e) => e.reaction?.replaceAll(`_`, ` `),
          maxPreviewLength: 24,
          valueName: `reaction`,
        }),
        add_reaction_to_pr_review_comment: E({
          getMessages: () => ({
            withoutContext: {
              active: F.add_reaction_to_pr_review_comment_active,
              completed: F.add_reaction_to_pr_review_comment_completed,
            },
            withContext: {
              active:
                F.add_reaction_to_pr_review_comment_activeWithReactionOnly,
              completed:
                F.add_reaction_to_pr_review_comment_completedWithReactionOnly,
            },
          }),
          getValue: (e) => e.reaction?.replaceAll(`_`, ` `),
          maxPreviewLength: 24,
          valueName: `reaction`,
        }),
        add_review_to_pr: w(() => ({
          active: F.add_review_to_pr_active,
          completed: F.add_review_to_pr_completed,
        })),
        check_repo_initialized: w(() => ({
          active: F.check_repo_initialized_active,
          completed: F.check_repo_initialized_completed,
        })),
        compare_commits: w(() => ({
          active: F.compare_commits_active,
          completed: F.compare_commits_completed,
        })),
        convert_pull_request_to_draft: M({
          getMessages: () => ({
            withoutContext: {
              active: F.convert_pull_request_to_draft_active,
              completed: F.convert_pull_request_to_draft_completed,
            },
            withContext: {
              active: F.convert_pull_request_to_draft_activeWithContext,
              completed: F.convert_pull_request_to_draft_completedWithContext,
            },
          }),
        }),
        create_blob: w(() => ({
          active: F.create_blob_active,
          completed: F.create_blob_completed,
        })),
        create_branch: E({
          getMessages: () => ({
            withoutContext: {
              active: F.create_branch_active,
              completed: F.create_branch_completed,
            },
            withContext: {
              active: F.create_branch_activeWithRepository,
              completed: F.create_branch_completedWithRepository,
            },
          }),
          getValue: (e) => e.repo_full_name ?? e.repository_full_name,
          maxPreviewLength: N,
          valueName: `repository`,
        }),
        create_commit: w(() => ({
          active: F.create_commit_active,
          completed: F.create_commit_completed,
        })),
        create_file: w(() => ({
          active: F.create_file_active,
          completed: F.create_file_completed,
        })),
        create_issue: T({
          getItemName: (e) => e.title,
          getMessages: () => ({
            withoutContext: {
              active: F.create_issue_active,
              completed: F.create_issue_completed,
            },
            withContext: {
              active: F.create_issue_activeWithTitle,
              completed: F.create_issue_completedWithTitle,
            },
          }),
          maxPreviewLength: N,
        }),
        create_pull_request: T({
          getItemName: (e) => e.title,
          getMessages: () => ({
            withoutContext: {
              active: F.create_pull_request_active,
              completed: F.create_pull_request_completed,
            },
            withContext: {
              active: F.create_pull_request_activeWithTitle,
              completed: F.create_pull_request_completedWithTitle,
            },
          }),
          maxPreviewLength: N,
        }),
        create_tree: w(() => ({
          active: F.create_tree_active,
          completed: F.create_tree_completed,
        })),
        delete_file: w(() => ({
          active: F.delete_file_active,
          completed: F.delete_file_completed,
        })),
        download_user_content: w(() => ({
          active: F.download_user_content_active,
          completed: F.download_user_content_completed,
        })),
        download_workflow_artifact: w(() => ({
          active: F.download_workflow_artifact_active,
          completed: F.download_workflow_artifact_completed,
        })),
        enable_auto_merge: w(() => ({
          active: F.enable_auto_merge_active,
          completed: F.enable_auto_merge_completed,
        })),
        fetch: w(() => ({
          active: F.fetch_file_active,
          completed: F.fetch_file_completed,
        })),
        fetch_blob: w(() => ({
          active: F.fetch_blob_active,
          completed: F.fetch_blob_completed,
        })),
        fetch_commit: w(() => ({
          active: F.fetch_commit_active,
          completed: F.fetch_commit_completed,
        })),
        fetch_commit_workflow_runs: w(() => ({
          active: F.fetch_commit_workflow_runs_active,
          completed: F.fetch_commit_workflow_runs_completed,
        })),
        fetch_file: w(() => ({
          active: F.fetch_file_active,
          completed: F.fetch_file_completed,
        })),
        fetch_issue: M({
          getMessages: () => ({
            withoutContext: {
              active: F.fetch_issue_active,
              completed: F.fetch_issue_completed,
            },
            withContext: {
              active: F.fetch_issue_activeWithContext,
              completed: F.fetch_issue_completedWithContext,
            },
          }),
        }),
        fetch_issue_comments: M({
          getMessages: () => ({
            withoutContext: {
              active: F.fetch_issue_comments_active,
              completed: F.fetch_issue_comments_completed,
            },
            withContext: {
              active: F.fetch_issue_comments_activeWithContext,
              completed: F.fetch_issue_comments_completedWithContext,
            },
          }),
        }),
        fetch_pr: M({
          getMessages: () => ({
            withoutContext: {
              active: F.fetch_pr_active,
              completed: F.fetch_pr_completed,
            },
            withContext: {
              active: F.fetch_pr_activeWithContext,
              completed: F.fetch_pr_completedWithContext,
            },
          }),
        }),
        fetch_pr_comments: M({
          getMessages: () => ({
            withoutContext: {
              active: F.fetch_pr_comments_active,
              completed: F.fetch_pr_comments_completed,
            },
            withContext: {
              active: F.fetch_pr_comments_activeWithContext,
              completed: F.fetch_pr_comments_completedWithContext,
            },
          }),
        }),
        fetch_pr_file_patch: w(() => ({
          active: F.fetch_pr_file_patch_active,
          completed: F.fetch_pr_file_patch_completed,
        })),
        fetch_pr_patch: w(() => ({
          active: F.fetch_pr_patch_active,
          completed: F.fetch_pr_patch_completed,
        })),
        fetch_workflow_job_logs: w(() => ({
          active: F.fetch_workflow_job_logs_active,
          completed: F.fetch_workflow_job_logs_completed,
        })),
        fetch_workflow_job_steps: w(() => ({
          active: F.fetch_workflow_job_steps_active,
          completed: F.fetch_workflow_job_steps_completed,
        })),
        fetch_workflow_run_artifacts: w(() => ({
          active: F.fetch_workflow_run_artifacts_active,
          completed: F.fetch_workflow_run_artifacts_completed,
        })),
        fetch_workflow_run_jobs: w(() => ({
          active: F.fetch_workflow_run_jobs_active,
          completed: F.fetch_workflow_run_jobs_completed,
        })),
        get_commit_combined_status: w(() => ({
          active: F.get_commit_combined_status_active,
          completed: F.get_commit_combined_status_completed,
        })),
        get_issue_comment_reactions: w(() => ({
          active: F.get_issue_comment_reactions_active,
          completed: F.get_issue_comment_reactions_completed,
        })),
        get_pr_diff: w(() => ({
          active: F.get_pr_diff_active,
          completed: F.get_pr_diff_completed,
        })),
        get_pr_info: M({
          getMessages: () => ({
            withoutContext: {
              active: F.get_pr_info_active,
              completed: F.get_pr_info_completed,
            },
            withContext: {
              active: F.get_pr_info_activeWithContext,
              completed: F.get_pr_info_completedWithContext,
            },
          }),
        }),
        get_pr_reactions: w(() => ({
          active: F.get_pr_reactions_active,
          completed: F.get_pr_reactions_completed,
        })),
        get_pr_review_comment_reactions: w(() => ({
          active: F.get_pr_review_comment_reactions_active,
          completed: F.get_pr_review_comment_reactions_completed,
        })),
        get_profile: w(() => ({
          active: F.get_profile_active,
          completed: F.get_profile_completed,
        })),
        get_repo: w(() => ({
          active: F.get_repo_active,
          completed: F.get_repo_completed,
        })),
        get_repo_collaborator_permission: w(() => ({
          active: F.get_repo_collaborator_permission_active,
          completed: F.get_repo_collaborator_permission_completed,
        })),
        get_user_login: w(() => ({
          active: F.get_user_login_active,
          completed: F.get_user_login_completed,
        })),
        get_users_recent_prs_in_repo: w(() => ({
          active: F.get_users_recent_prs_in_repo_active,
          completed: F.get_users_recent_prs_in_repo_completed,
        })),
        label_pr: M({
          getMessages: () => ({
            withoutContext: {
              active: F.label_pr_active,
              completed: F.label_pr_completed,
            },
            withContext: {
              active: F.label_pr_activeWithContext,
              completed: F.label_pr_completedWithContext,
            },
          }),
        }),
        list_installations: w(() => ({
          active: F.list_installations_active,
          completed: F.list_installations_completed,
        })),
        list_installed_accounts: w(() => ({
          active: F.list_installed_accounts_active,
          completed: F.list_installed_accounts_completed,
        })),
        list_pr_changed_filenames: w(() => ({
          active: F.list_pr_changed_filenames_active,
          completed: F.list_pr_changed_filenames_completed,
        })),
        list_pull_request_review_threads: w(() => ({
          active: F.list_pull_request_review_threads_active,
          completed: F.list_pull_request_review_threads_completed,
        })),
        list_pull_request_reviews: w(() => ({
          active: F.list_pull_request_reviews_active,
          completed: F.list_pull_request_reviews_completed,
        })),
        list_recent_issues: w(() => ({
          active: F.list_recent_issues_active,
          completed: F.list_recent_issues_completed,
        })),
        list_repositories: w(() => ({
          active: F.list_repositories_active,
          completed: F.list_repositories_completed,
        })),
        list_repositories_by_affiliation: w(() => ({
          active: F.list_repositories_active,
          completed: F.list_repositories_completed,
        })),
        list_repositories_by_installation: w(() => ({
          active: F.list_repositories_active,
          completed: F.list_repositories_completed,
        })),
        list_user_org_memberships: w(() => ({
          active: F.list_user_org_memberships_active,
          completed: F.list_user_org_memberships_completed,
        })),
        list_user_orgs: w(() => ({
          active: F.list_user_orgs_active,
          completed: F.list_user_orgs_completed,
        })),
        mark_pull_request_ready_for_review: M({
          getMessages: () => ({
            withoutContext: {
              active: F.mark_pull_request_ready_for_review_active,
              completed: F.mark_pull_request_ready_for_review_completed,
            },
            withContext: {
              active: F.mark_pull_request_ready_for_review_activeWithContext,
              completed:
                F.mark_pull_request_ready_for_review_completedWithContext,
            },
          }),
        }),
        merge_pull_request: M({
          getMessages: () => ({
            withoutContext: {
              active: F.merge_pull_request_active,
              completed: F.merge_pull_request_completed,
            },
            withContext: {
              active: F.merge_pull_request_activeWithContext,
              completed: F.merge_pull_request_completedWithContext,
            },
          }),
        }),
        remove_issue_assignees: M({
          getMessages: () => ({
            withoutContext: {
              active: F.remove_issue_assignees_active,
              completed: F.remove_issue_assignees_completed,
            },
            withContext: {
              active: F.remove_issue_assignees_activeWithContext,
              completed: F.remove_issue_assignees_completedWithContext,
            },
          }),
        }),
        remove_issue_label: M({
          getMessages: () => ({
            withoutContext: {
              active: F.remove_issue_label_active,
              completed: F.remove_issue_label_completed,
            },
            withContext: {
              active: F.remove_issue_label_activeWithContext,
              completed: F.remove_issue_label_completedWithContext,
            },
          }),
        }),
        remove_reaction_from_issue_comment: w(() => ({
          active: F.remove_reaction_from_issue_comment_active,
          completed: F.remove_reaction_from_issue_comment_completed,
        })),
        remove_reaction_from_pr: w(() => ({
          active: F.remove_reaction_from_pr_active,
          completed: F.remove_reaction_from_pr_completed,
        })),
        remove_reaction_from_pr_review_comment: w(() => ({
          active: F.remove_reaction_from_pr_review_comment_active,
          completed: F.remove_reaction_from_pr_review_comment_completed,
        })),
        reply_to_review_comment: w(() => ({
          active: F.reply_to_review_comment_active,
          completed: F.reply_to_review_comment_completed,
        })),
        request_pull_request_reviewers: M({
          getMessages: () => ({
            withoutContext: {
              active: F.request_pull_request_reviewers_active,
              completed: F.request_pull_request_reviewers_completed,
            },
            withContext: {
              active: F.request_pull_request_reviewers_activeWithContext,
              completed: F.request_pull_request_reviewers_completedWithContext,
            },
          }),
        }),
        rerun_failed_workflow_run_jobs: w(() => ({
          active: F.rerun_failed_workflow_run_jobs_active,
          completed: F.rerun_failed_workflow_run_jobs_completed,
        })),
        rerun_workflow_job: w(() => ({
          active: F.rerun_workflow_job_active,
          completed: F.rerun_workflow_job_completed,
        })),
        resolve_review_thread: w(() => ({
          active: F.resolve_review_thread_active,
          completed: F.resolve_review_thread_completed,
        })),
        search: E({
          getMessages: () => ({
            withoutContext: {
              active: F.search_active,
              completed: F.search_completed,
            },
            withContext: {
              active: F.search_activeWithQuery,
              completed: F.search_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: N,
          valueName: `query`,
        }),
        search_branches: E({
          getMessages: () => ({
            withoutContext: {
              active: F.search_branches_active,
              completed: F.search_branches_completed,
            },
            withContext: {
              active: F.search_branches_activeWithQuery,
              completed: F.search_branches_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: N,
          valueName: `query`,
        }),
        search_commits: E({
          getMessages: () => ({
            withoutContext: {
              active: F.search_commits_active,
              completed: F.search_commits_completed,
            },
            withContext: {
              active: F.search_commits_activeWithQuery,
              completed: F.search_commits_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: N,
          valueName: `query`,
        }),
        search_installed_repositories_streaming: w(() => ({
          active: F.search_repositories_active,
          completed: F.search_repositories_completed,
        })),
        search_installed_repositories_v2: E({
          getMessages: () => ({
            withoutContext: {
              active: F.search_repositories_active,
              completed: F.search_repositories_completed,
            },
            withContext: {
              active: F.search_repositories_activeWithQuery,
              completed: F.search_repositories_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: N,
          valueName: `query`,
        }),
        search_issues: E({
          getMessages: () => ({
            withoutContext: {
              active: F.search_issues_active,
              completed: F.search_issues_completed,
            },
            withContext: {
              active: F.search_issues_activeWithQuery,
              completed: F.search_issues_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: N,
          valueName: `query`,
        }),
        search_prs: E({
          getMessages: () => ({
            withoutContext: {
              active: F.search_prs_active,
              completed: F.search_prs_completed,
            },
            withContext: {
              active: F.search_prs_activeWithQuery,
              completed: F.search_prs_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: N,
          valueName: `query`,
        }),
        search_repositories: E({
          getMessages: () => ({
            withoutContext: {
              active: F.search_repositories_active,
              completed: F.search_repositories_completed,
            },
            withContext: {
              active: F.search_repositories_activeWithQuery,
              completed: F.search_repositories_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: N,
          valueName: `query`,
        }),
        update_file: w(() => ({
          active: F.update_file_active,
          completed: F.update_file_completed,
        })),
        update_issue: M({
          getMessages: () => ({
            withoutContext: {
              active: F.update_issue_active,
              completed: F.update_issue_completed,
            },
            withContext: {
              active: F.update_issue_activeWithContext,
              completed: F.update_issue_completedWithContext,
            },
          }),
        }),
        update_issue_comment: w(() => ({
          active: F.update_issue_comment_active,
          completed: F.update_issue_comment_completed,
        })),
        update_pull_request: M({
          getMessages: () => ({
            withoutContext: {
              active: F.update_pull_request_active,
              completed: F.update_pull_request_completed,
            },
            withContext: {
              active: F.update_pull_request_activeWithContext,
              completed: F.update_pull_request_completedWithContext,
            },
          }),
        }),
        update_ref: E({
          getMessages: () => ({
            withoutContext: {
              active: F.update_ref_active,
              completed: F.update_ref_completed,
            },
            withContext: {
              active: F.update_ref_activeWithRepository,
              completed: F.update_ref_completedWithRepository,
            },
          }),
          getValue: (e) => e.repo_full_name ?? e.repository_full_name,
          maxPreviewLength: N,
          valueName: `repository`,
        }),
        update_review_comment: w(() => ({
          active: F.update_review_comment_active,
          completed: F.update_review_comment_completed,
        })),
      }),
      (Fn = C({ appRegistryKey: Dn, toolArgumentsSchema: kn, tools: Pn })),
      (F = h({
        add_comment_to_issue_active: {
          id: `localConversation.mcpToolActivity.github.add_comment_to_issue.active`,
        },
        add_comment_to_issue_completed: {
          id: `localConversation.mcpToolActivity.github.add_comment_to_issue.completed`,
        },
        add_issue_assignees_active: {
          id: `localConversation.mcpToolActivity.github.add_issue_assignees.active`,
        },
        add_issue_assignees_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.add_issue_assignees.activeWithContext`,
        },
        add_issue_assignees_completed: {
          id: `localConversation.mcpToolActivity.github.add_issue_assignees.completed`,
        },
        add_issue_assignees_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.add_issue_assignees.completedWithContext`,
        },
        add_issue_labels_active: {
          id: `localConversation.mcpToolActivity.github.add_issue_labels.active`,
        },
        add_issue_labels_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.add_issue_labels.activeWithContext`,
        },
        add_issue_labels_completed: {
          id: `localConversation.mcpToolActivity.github.add_issue_labels.completed`,
        },
        add_issue_labels_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.add_issue_labels.completedWithContext`,
        },
        add_reaction_to_issue_comment_active: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_issue_comment.active`,
        },
        add_reaction_to_issue_comment_activeWithReactionOnly: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_issue_comment.activeWithReactionOnly`,
        },
        add_reaction_to_issue_comment_completed: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_issue_comment.completed`,
        },
        add_reaction_to_issue_comment_completedWithReactionOnly: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_issue_comment.completedWithReactionOnly`,
        },
        add_reaction_to_pr_active: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr.active`,
        },
        add_reaction_to_pr_activeWithReactionOnly: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr.activeWithReactionOnly`,
        },
        add_reaction_to_pr_completed: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr.completed`,
        },
        add_reaction_to_pr_completedWithReactionOnly: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr.completedWithReactionOnly`,
        },
        add_reaction_to_pr_review_comment_active: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr_review_comment.active`,
        },
        add_reaction_to_pr_review_comment_activeWithReactionOnly: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr_review_comment.activeWithReactionOnly`,
        },
        add_reaction_to_pr_review_comment_completed: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr_review_comment.completed`,
        },
        add_reaction_to_pr_review_comment_completedWithReactionOnly: {
          id: `localConversation.mcpToolActivity.github.add_reaction_to_pr_review_comment.completedWithReactionOnly`,
        },
        add_review_to_pr_active: {
          id: `localConversation.mcpToolActivity.github.add_review_to_pr.active`,
        },
        add_review_to_pr_completed: {
          id: `localConversation.mcpToolActivity.github.add_review_to_pr.completed`,
        },
        check_repo_initialized_active: {
          id: `localConversation.mcpToolActivity.github.check_repo_initialized.active`,
        },
        check_repo_initialized_completed: {
          id: `localConversation.mcpToolActivity.github.check_repo_initialized.completed`,
        },
        compare_commits_active: {
          id: `localConversation.mcpToolActivity.github.compare_commits.active`,
        },
        compare_commits_completed: {
          id: `localConversation.mcpToolActivity.github.compare_commits.completed`,
        },
        convert_pull_request_to_draft_active: {
          id: `localConversation.mcpToolActivity.github.convert_pull_request_to_draft.active`,
        },
        convert_pull_request_to_draft_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.convert_pull_request_to_draft.activeWithContext`,
        },
        convert_pull_request_to_draft_completed: {
          id: `localConversation.mcpToolActivity.github.convert_pull_request_to_draft.completed`,
        },
        convert_pull_request_to_draft_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.convert_pull_request_to_draft.completedWithContext`,
        },
        create_blob_active: {
          id: `localConversation.mcpToolActivity.github.create_blob.active`,
        },
        create_blob_completed: {
          id: `localConversation.mcpToolActivity.github.create_blob.completed`,
        },
        create_branch_active: {
          id: `localConversation.mcpToolActivity.github.create_branch.active`,
        },
        create_branch_activeWithRepository: {
          id: `localConversation.mcpToolActivity.github.create_branch.activeWithRepository`,
        },
        create_branch_completed: {
          id: `localConversation.mcpToolActivity.github.create_branch.completed`,
        },
        create_branch_completedWithRepository: {
          id: `localConversation.mcpToolActivity.github.create_branch.completedWithRepository`,
        },
        create_commit_active: {
          id: `localConversation.mcpToolActivity.github.create_commit.active`,
        },
        create_commit_completed: {
          id: `localConversation.mcpToolActivity.github.create_commit.completed`,
        },
        create_file_active: {
          id: `localConversation.mcpToolActivity.github.create_file.active`,
        },
        create_file_completed: {
          id: `localConversation.mcpToolActivity.github.create_file.completed`,
        },
        create_issue_active: {
          id: `localConversation.mcpToolActivity.github.create_issue.active`,
        },
        create_issue_activeWithTitle: {
          id: `localConversation.mcpToolActivity.github.create_issue.activeWithTitle`,
        },
        create_issue_completed: {
          id: `localConversation.mcpToolActivity.github.create_issue.completed`,
        },
        create_issue_completedWithTitle: {
          id: `localConversation.mcpToolActivity.github.create_issue.completedWithTitle`,
        },
        create_pull_request_active: {
          id: `localConversation.mcpToolActivity.github.create_pull_request.active`,
        },
        create_pull_request_activeWithTitle: {
          id: `localConversation.mcpToolActivity.github.create_pull_request.activeWithTitle`,
        },
        create_pull_request_completed: {
          id: `localConversation.mcpToolActivity.github.create_pull_request.completed`,
        },
        create_pull_request_completedWithTitle: {
          id: `localConversation.mcpToolActivity.github.create_pull_request.completedWithTitle`,
        },
        create_tree_active: {
          id: `localConversation.mcpToolActivity.github.create_tree.active`,
        },
        create_tree_completed: {
          id: `localConversation.mcpToolActivity.github.create_tree.completed`,
        },
        delete_file_active: {
          id: `localConversation.mcpToolActivity.github.delete_file.active`,
        },
        delete_file_completed: {
          id: `localConversation.mcpToolActivity.github.delete_file.completed`,
        },
        download_user_content_active: {
          id: `localConversation.mcpToolActivity.github.download_user_content.active`,
        },
        download_user_content_completed: {
          id: `localConversation.mcpToolActivity.github.download_user_content.completed`,
        },
        download_workflow_artifact_active: {
          id: `localConversation.mcpToolActivity.github.download_workflow_artifact.active`,
        },
        download_workflow_artifact_completed: {
          id: `localConversation.mcpToolActivity.github.download_workflow_artifact.completed`,
        },
        enable_auto_merge_active: {
          id: `localConversation.mcpToolActivity.github.enable_auto_merge.active`,
        },
        enable_auto_merge_completed: {
          id: `localConversation.mcpToolActivity.github.enable_auto_merge.completed`,
        },
        fetch_blob_active: {
          id: `localConversation.mcpToolActivity.github.fetch_blob.active`,
        },
        fetch_blob_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_blob.completed`,
        },
        fetch_commit_active: {
          id: `localConversation.mcpToolActivity.github.fetch_commit.active`,
        },
        fetch_commit_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_commit.completed`,
        },
        fetch_commit_workflow_runs_active: {
          id: `localConversation.mcpToolActivity.github.fetch_commit_workflow_runs.active`,
        },
        fetch_commit_workflow_runs_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_commit_workflow_runs.completed`,
        },
        fetch_file_active: {
          id: `localConversation.mcpToolActivity.github.fetch_file.active`,
        },
        fetch_file_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_file.completed`,
        },
        fetch_issue_active: {
          id: `localConversation.mcpToolActivity.github.fetch_issue.active`,
        },
        fetch_issue_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_issue.activeWithContext`,
        },
        fetch_issue_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_issue.completed`,
        },
        fetch_issue_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_issue.completedWithContext`,
        },
        fetch_issue_comments_active: {
          id: `localConversation.mcpToolActivity.github.fetch_issue_comments.active`,
        },
        fetch_issue_comments_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_issue_comments.activeWithContext`,
        },
        fetch_issue_comments_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_issue_comments.completed`,
        },
        fetch_issue_comments_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_issue_comments.completedWithContext`,
        },
        fetch_pr_active: {
          id: `localConversation.mcpToolActivity.github.fetch_pr.active`,
        },
        fetch_pr_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_pr.activeWithContext`,
        },
        fetch_pr_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_pr.completed`,
        },
        fetch_pr_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_pr.completedWithContext`,
        },
        fetch_pr_comments_active: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_comments.active`,
        },
        fetch_pr_comments_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_comments.activeWithContext`,
        },
        fetch_pr_comments_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_comments.completed`,
        },
        fetch_pr_comments_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_comments.completedWithContext`,
        },
        fetch_pr_file_patch_active: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_file_patch.active`,
        },
        fetch_pr_file_patch_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_file_patch.completed`,
        },
        fetch_pr_patch_active: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_patch.active`,
        },
        fetch_pr_patch_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_pr_patch.completed`,
        },
        fetch_workflow_job_logs_active: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_job_logs.active`,
        },
        fetch_workflow_job_logs_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_job_logs.completed`,
        },
        fetch_workflow_job_steps_active: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_job_steps.active`,
        },
        fetch_workflow_job_steps_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_job_steps.completed`,
        },
        fetch_workflow_run_artifacts_active: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_run_artifacts.active`,
        },
        fetch_workflow_run_artifacts_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_run_artifacts.completed`,
        },
        fetch_workflow_run_jobs_active: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_run_jobs.active`,
        },
        fetch_workflow_run_jobs_completed: {
          id: `localConversation.mcpToolActivity.github.fetch_workflow_run_jobs.completed`,
        },
        get_commit_combined_status_active: {
          id: `localConversation.mcpToolActivity.github.get_commit_combined_status.active`,
        },
        get_commit_combined_status_completed: {
          id: `localConversation.mcpToolActivity.github.get_commit_combined_status.completed`,
        },
        get_issue_comment_reactions_active: {
          id: `localConversation.mcpToolActivity.github.get_issue_comment_reactions.active`,
        },
        get_issue_comment_reactions_completed: {
          id: `localConversation.mcpToolActivity.github.get_issue_comment_reactions.completed`,
        },
        get_pr_diff_active: {
          id: `localConversation.mcpToolActivity.github.get_pr_diff.active`,
        },
        get_pr_diff_completed: {
          id: `localConversation.mcpToolActivity.github.get_pr_diff.completed`,
        },
        get_pr_info_active: {
          id: `localConversation.mcpToolActivity.github.get_pr_info.active`,
        },
        get_pr_info_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.get_pr_info.activeWithContext`,
        },
        get_pr_info_completed: {
          id: `localConversation.mcpToolActivity.github.get_pr_info.completed`,
        },
        get_pr_info_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.get_pr_info.completedWithContext`,
        },
        get_pr_reactions_active: {
          id: `localConversation.mcpToolActivity.github.get_pr_reactions.active`,
        },
        get_pr_reactions_completed: {
          id: `localConversation.mcpToolActivity.github.get_pr_reactions.completed`,
        },
        get_pr_review_comment_reactions_active: {
          id: `localConversation.mcpToolActivity.github.get_pr_review_comment_reactions.active`,
        },
        get_pr_review_comment_reactions_completed: {
          id: `localConversation.mcpToolActivity.github.get_pr_review_comment_reactions.completed`,
        },
        get_profile_active: {
          id: `localConversation.mcpToolActivity.github.get_profile.active`,
        },
        get_profile_completed: {
          id: `localConversation.mcpToolActivity.github.get_profile.completed`,
        },
        get_repo_active: {
          id: `localConversation.mcpToolActivity.github.get_repo.active`,
        },
        get_repo_completed: {
          id: `localConversation.mcpToolActivity.github.get_repo.completed`,
        },
        get_repo_collaborator_permission_active: {
          id: `localConversation.mcpToolActivity.github.get_repo_collaborator_permission.active`,
        },
        get_repo_collaborator_permission_completed: {
          id: `localConversation.mcpToolActivity.github.get_repo_collaborator_permission.completed`,
        },
        get_user_login_active: {
          id: `localConversation.mcpToolActivity.github.get_user_login.active`,
        },
        get_user_login_completed: {
          id: `localConversation.mcpToolActivity.github.get_user_login.completed`,
        },
        get_users_recent_prs_in_repo_active: {
          id: `localConversation.mcpToolActivity.github.get_users_recent_prs_in_repo.active`,
        },
        get_users_recent_prs_in_repo_completed: {
          id: `localConversation.mcpToolActivity.github.get_users_recent_prs_in_repo.completed`,
        },
        label_pr_active: {
          id: `localConversation.mcpToolActivity.github.label_pr.active`,
        },
        label_pr_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.label_pr.activeWithContext`,
        },
        label_pr_completed: {
          id: `localConversation.mcpToolActivity.github.label_pr.completed`,
        },
        label_pr_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.label_pr.completedWithContext`,
        },
        list_installations_active: {
          id: `localConversation.mcpToolActivity.github.list_installations.active`,
        },
        list_installations_completed: {
          id: `localConversation.mcpToolActivity.github.list_installations.completed`,
        },
        list_installed_accounts_active: {
          id: `localConversation.mcpToolActivity.github.list_installed_accounts.active`,
        },
        list_installed_accounts_completed: {
          id: `localConversation.mcpToolActivity.github.list_installed_accounts.completed`,
        },
        list_pr_changed_filenames_active: {
          id: `localConversation.mcpToolActivity.github.list_pr_changed_filenames.active`,
        },
        list_pr_changed_filenames_completed: {
          id: `localConversation.mcpToolActivity.github.list_pr_changed_filenames.completed`,
        },
        list_pull_request_review_threads_active: {
          id: `localConversation.mcpToolActivity.github.list_pull_request_review_threads.active`,
        },
        list_pull_request_review_threads_completed: {
          id: `localConversation.mcpToolActivity.github.list_pull_request_review_threads.completed`,
        },
        list_pull_request_reviews_active: {
          id: `localConversation.mcpToolActivity.github.list_pull_request_reviews.active`,
        },
        list_pull_request_reviews_completed: {
          id: `localConversation.mcpToolActivity.github.list_pull_request_reviews.completed`,
        },
        list_recent_issues_active: {
          id: `localConversation.mcpToolActivity.github.list_recent_issues.active`,
        },
        list_recent_issues_completed: {
          id: `localConversation.mcpToolActivity.github.list_recent_issues.completed`,
        },
        list_repositories_active: {
          id: `localConversation.mcpToolActivity.github.list_repositories.active`,
        },
        list_repositories_completed: {
          id: `localConversation.mcpToolActivity.github.list_repositories.completed`,
        },
        list_user_org_memberships_active: {
          id: `localConversation.mcpToolActivity.github.list_user_org_memberships.active`,
        },
        list_user_org_memberships_completed: {
          id: `localConversation.mcpToolActivity.github.list_user_org_memberships.completed`,
        },
        list_user_orgs_active: {
          id: `localConversation.mcpToolActivity.github.list_user_orgs.active`,
        },
        list_user_orgs_completed: {
          id: `localConversation.mcpToolActivity.github.list_user_orgs.completed`,
        },
        mark_pull_request_ready_for_review_active: {
          id: `localConversation.mcpToolActivity.github.mark_pull_request_ready_for_review.active`,
        },
        mark_pull_request_ready_for_review_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.mark_pull_request_ready_for_review.activeWithContext`,
        },
        mark_pull_request_ready_for_review_completed: {
          id: `localConversation.mcpToolActivity.github.mark_pull_request_ready_for_review.completed`,
        },
        mark_pull_request_ready_for_review_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.mark_pull_request_ready_for_review.completedWithContext`,
        },
        merge_pull_request_active: {
          id: `localConversation.mcpToolActivity.github.merge_pull_request.active`,
        },
        merge_pull_request_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.merge_pull_request.activeWithContext`,
        },
        merge_pull_request_completed: {
          id: `localConversation.mcpToolActivity.github.merge_pull_request.completed`,
        },
        merge_pull_request_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.merge_pull_request.completedWithContext`,
        },
        remove_issue_assignees_active: {
          id: `localConversation.mcpToolActivity.github.remove_issue_assignees.active`,
        },
        remove_issue_assignees_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.remove_issue_assignees.activeWithContext`,
        },
        remove_issue_assignees_completed: {
          id: `localConversation.mcpToolActivity.github.remove_issue_assignees.completed`,
        },
        remove_issue_assignees_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.remove_issue_assignees.completedWithContext`,
        },
        remove_issue_label_active: {
          id: `localConversation.mcpToolActivity.github.remove_issue_label.active`,
        },
        remove_issue_label_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.remove_issue_label.activeWithContext`,
        },
        remove_issue_label_completed: {
          id: `localConversation.mcpToolActivity.github.remove_issue_label.completed`,
        },
        remove_issue_label_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.remove_issue_label.completedWithContext`,
        },
        remove_reaction_from_issue_comment_active: {
          id: `localConversation.mcpToolActivity.github.remove_reaction_from_issue_comment.active`,
        },
        remove_reaction_from_issue_comment_completed: {
          id: `localConversation.mcpToolActivity.github.remove_reaction_from_issue_comment.completed`,
        },
        remove_reaction_from_pr_active: {
          id: `localConversation.mcpToolActivity.github.remove_reaction_from_pr.active`,
        },
        remove_reaction_from_pr_completed: {
          id: `localConversation.mcpToolActivity.github.remove_reaction_from_pr.completed`,
        },
        remove_reaction_from_pr_review_comment_active: {
          id: `localConversation.mcpToolActivity.github.remove_reaction_from_pr_review_comment.active`,
        },
        remove_reaction_from_pr_review_comment_completed: {
          id: `localConversation.mcpToolActivity.github.remove_reaction_from_pr_review_comment.completed`,
        },
        reply_to_review_comment_active: {
          id: `localConversation.mcpToolActivity.github.reply_to_review_comment.active`,
        },
        reply_to_review_comment_completed: {
          id: `localConversation.mcpToolActivity.github.reply_to_review_comment.completed`,
        },
        request_pull_request_reviewers_active: {
          id: `localConversation.mcpToolActivity.github.request_pull_request_reviewers.active`,
        },
        request_pull_request_reviewers_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.request_pull_request_reviewers.activeWithContext`,
        },
        request_pull_request_reviewers_completed: {
          id: `localConversation.mcpToolActivity.github.request_pull_request_reviewers.completed`,
        },
        request_pull_request_reviewers_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.request_pull_request_reviewers.completedWithContext`,
        },
        rerun_failed_workflow_run_jobs_active: {
          id: `localConversation.mcpToolActivity.github.rerun_failed_workflow_run_jobs.active`,
        },
        rerun_failed_workflow_run_jobs_completed: {
          id: `localConversation.mcpToolActivity.github.rerun_failed_workflow_run_jobs.completed`,
        },
        rerun_workflow_job_active: {
          id: `localConversation.mcpToolActivity.github.rerun_workflow_job.active`,
        },
        rerun_workflow_job_completed: {
          id: `localConversation.mcpToolActivity.github.rerun_workflow_job.completed`,
        },
        resolve_review_thread_active: {
          id: `localConversation.mcpToolActivity.github.resolve_review_thread.active`,
        },
        resolve_review_thread_completed: {
          id: `localConversation.mcpToolActivity.github.resolve_review_thread.completed`,
        },
        search_active: {
          id: `localConversation.mcpToolActivity.github.search.active`,
        },
        search_activeWithQuery: {
          id: `localConversation.mcpToolActivity.github.search.activeWithQuery`,
        },
        search_completed: {
          id: `localConversation.mcpToolActivity.github.search.completed`,
        },
        search_completedWithQuery: {
          id: `localConversation.mcpToolActivity.github.search.completedWithQuery`,
        },
        search_branches_active: {
          id: `localConversation.mcpToolActivity.github.search_branches.active`,
        },
        search_branches_activeWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_branches.activeWithQuery`,
        },
        search_branches_completed: {
          id: `localConversation.mcpToolActivity.github.search_branches.completed`,
        },
        search_branches_completedWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_branches.completedWithQuery`,
        },
        search_commits_active: {
          id: `localConversation.mcpToolActivity.github.search_commits.active`,
        },
        search_commits_activeWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_commits.activeWithQuery`,
        },
        search_commits_completed: {
          id: `localConversation.mcpToolActivity.github.search_commits.completed`,
        },
        search_commits_completedWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_commits.completedWithQuery`,
        },
        search_issues_active: {
          id: `localConversation.mcpToolActivity.github.search_issues.active`,
        },
        search_issues_activeWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_issues.activeWithQuery`,
        },
        search_issues_completed: {
          id: `localConversation.mcpToolActivity.github.search_issues.completed`,
        },
        search_issues_completedWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_issues.completedWithQuery`,
        },
        search_prs_active: {
          id: `localConversation.mcpToolActivity.github.search_prs.active`,
        },
        search_prs_activeWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_prs.activeWithQuery`,
        },
        search_prs_completed: {
          id: `localConversation.mcpToolActivity.github.search_prs.completed`,
        },
        search_prs_completedWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_prs.completedWithQuery`,
        },
        search_repositories_active: {
          id: `localConversation.mcpToolActivity.github.search_repositories.active`,
        },
        search_repositories_activeWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_repositories.activeWithQuery`,
        },
        search_repositories_completed: {
          id: `localConversation.mcpToolActivity.github.search_repositories.completed`,
        },
        search_repositories_completedWithQuery: {
          id: `localConversation.mcpToolActivity.github.search_repositories.completedWithQuery`,
        },
        update_file_active: {
          id: `localConversation.mcpToolActivity.github.update_file.active`,
        },
        update_file_completed: {
          id: `localConversation.mcpToolActivity.github.update_file.completed`,
        },
        update_issue_active: {
          id: `localConversation.mcpToolActivity.github.update_issue.active`,
        },
        update_issue_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.update_issue.activeWithContext`,
        },
        update_issue_completed: {
          id: `localConversation.mcpToolActivity.github.update_issue.completed`,
        },
        update_issue_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.update_issue.completedWithContext`,
        },
        update_issue_comment_active: {
          id: `localConversation.mcpToolActivity.github.update_issue_comment.active`,
        },
        update_issue_comment_completed: {
          id: `localConversation.mcpToolActivity.github.update_issue_comment.completed`,
        },
        update_pull_request_active: {
          id: `localConversation.mcpToolActivity.github.update_pull_request.active`,
        },
        update_pull_request_activeWithContext: {
          id: `localConversation.mcpToolActivity.github.update_pull_request.activeWithContext`,
        },
        update_pull_request_completed: {
          id: `localConversation.mcpToolActivity.github.update_pull_request.completed`,
        },
        update_pull_request_completedWithContext: {
          id: `localConversation.mcpToolActivity.github.update_pull_request.completedWithContext`,
        },
        update_ref_active: {
          id: `localConversation.mcpToolActivity.github.update_ref.active`,
        },
        update_ref_activeWithRepository: {
          id: `localConversation.mcpToolActivity.github.update_ref.activeWithRepository`,
        },
        update_ref_completed: {
          id: `localConversation.mcpToolActivity.github.update_ref.completed`,
        },
        update_ref_completedWithRepository: {
          id: `localConversation.mcpToolActivity.github.update_ref.completedWithRepository`,
        },
        update_review_comment_active: {
          id: `localConversation.mcpToolActivity.github.update_review_comment.active`,
        },
        update_review_comment_completed: {
          id: `localConversation.mcpToolActivity.github.update_review_comment.completed`,
        },
      })),
      (In = h({
        add_comment_to_issue: {
          id: `localConversation.mcpToolApproval.github.add_comment_to_issue.context`,
        },
        add_issue_assignees: {
          id: `localConversation.mcpToolApproval.github.add_issue_assignees.context`,
        },
        add_issue_labels: {
          id: `localConversation.mcpToolApproval.github.add_issue_labels.context`,
        },
        add_reaction_to_issue_comment: {
          id: `localConversation.mcpToolApproval.github.add_reaction_to_issue_comment.context`,
        },
        add_reaction_to_pr: {
          id: `localConversation.mcpToolApproval.github.add_reaction_to_pr.context`,
        },
        add_reaction_to_pr_review_comment: {
          id: `localConversation.mcpToolApproval.github.add_reaction_to_pr_review_comment.context`,
        },
        add_review_to_pr: {
          id: `localConversation.mcpToolApproval.github.add_review_to_pr.context`,
        },
        convert_pull_request_to_draft: {
          id: `localConversation.mcpToolApproval.github.convert_pull_request_to_draft.context`,
        },
        create_blob: {
          id: `localConversation.mcpToolApproval.github.create_blob.context`,
        },
        create_branch: {
          id: `localConversation.mcpToolApproval.github.create_branch.context`,
        },
        create_commit: {
          id: `localConversation.mcpToolApproval.github.create_commit.context`,
        },
        create_file: {
          id: `localConversation.mcpToolApproval.github.create_file.context`,
        },
        create_issue: {
          id: `localConversation.mcpToolApproval.github.create_issue.context_v3`,
        },
        create_pull_request: {
          id: `localConversation.mcpToolApproval.github.create_pull_request.context_v3`,
        },
        create_tree: {
          id: `localConversation.mcpToolApproval.github.create_tree.context`,
        },
        delete_file: {
          id: `localConversation.mcpToolApproval.github.delete_file.context`,
        },
        dismiss_pull_request_review: {
          id: `localConversation.mcpToolApproval.github.dismiss_pull_request_review.context`,
        },
        enable_auto_merge: {
          id: `localConversation.mcpToolApproval.github.enable_auto_merge.context`,
        },
        label_pr: {
          id: `localConversation.mcpToolApproval.github.label_pr.context`,
        },
        lock_issue_conversation: {
          id: `localConversation.mcpToolApproval.github.lock_issue_conversation.context_v2`,
        },
        mark_pull_request_ready_for_review: {
          id: `localConversation.mcpToolApproval.github.mark_pull_request_ready_for_review.context`,
        },
        merge_pull_request: {
          id: `localConversation.mcpToolApproval.github.merge_pull_request.context_v2`,
        },
        remove_issue_assignees: {
          id: `localConversation.mcpToolApproval.github.remove_issue_assignees.context`,
        },
        remove_issue_label: {
          id: `localConversation.mcpToolApproval.github.remove_issue_label.context`,
        },
        remove_pull_request_reviewers: {
          id: `localConversation.mcpToolApproval.github.remove_pull_request_reviewers.context`,
        },
        remove_reaction_from_issue_comment: {
          id: `localConversation.mcpToolApproval.github.remove_reaction_from_issue_comment.context`,
        },
        remove_reaction_from_pr: {
          id: `localConversation.mcpToolApproval.github.remove_reaction_from_pr.context`,
        },
        remove_reaction_from_pr_review_comment: {
          id: `localConversation.mcpToolApproval.github.remove_reaction_from_pr_review_comment.context`,
        },
        reply_to_review_comment: {
          id: `localConversation.mcpToolApproval.github.reply_to_review_comment.context`,
        },
        request_pull_request_reviewers: {
          id: `localConversation.mcpToolApproval.github.request_pull_request_reviewers.context`,
        },
        rerun_failed_workflow_run_jobs: {
          id: `localConversation.mcpToolApproval.github.rerun_failed_workflow_run_jobs.context`,
        },
        rerun_workflow_job: {
          id: `localConversation.mcpToolApproval.github.rerun_workflow_job.context`,
        },
        resolve_review_thread: {
          id: `localConversation.mcpToolApproval.github.resolve_review_thread.fallback`,
        },
        unlock_issue_conversation: {
          id: `localConversation.mcpToolApproval.github.unlock_issue_conversation.context`,
        },
        unresolve_review_thread: {
          id: `localConversation.mcpToolApproval.github.unresolve_review_thread.fallback`,
        },
        update_file: {
          id: `localConversation.mcpToolApproval.github.update_file.context`,
        },
        update_issue: {
          id: `localConversation.mcpToolApproval.github.update_issue.context_v3`,
        },
        update_issue_comment: {
          id: `localConversation.mcpToolApproval.github.update_issue_comment.context`,
        },
        update_pull_request: {
          id: `localConversation.mcpToolApproval.github.update_pull_request.context_v2`,
        },
        update_ref: {
          id: `localConversation.mcpToolApproval.github.update_ref.context`,
        },
        update_review_comment: {
          id: `localConversation.mcpToolApproval.github.update_review_comment.context`,
        },
      })));
  }))();
}
function I(e) {
  return D({ maxLength: Kn, value: e });
}
function Rn({ fallback: e, toolArguments: t, withContext: n }) {
  let r = I(t?.subject),
    i = I(t?.to),
    a = I(t?.cc),
    o = I(t?.bcc),
    s = I(t?.body),
    c = t?.attachment_files?.length ?? 0;
  return r == null &&
    i == null &&
    a == null &&
    o == null &&
    s == null &&
    c === 0
    ? { descriptor: e }
    : {
        descriptor: n,
        values: {
          attachmentCount: c,
          bcc: o ?? ``,
          body: s ?? ``,
          cc: a ?? ``,
          hasBcc: o == null ? `no` : `yes`,
          hasBody: s == null ? `no` : `yes`,
          hasCc: a == null ? `no` : `yes`,
          hasSubject: r == null ? `no` : `yes`,
          hasTo: i == null ? `no` : `yes`,
          subject: r ?? ``,
          to: i ?? ``,
        },
      };
}
function zn({ fallback: e, toolArguments: t, withCount: n }) {
  let r = t?.message_ids?.length;
  return r == null || r === 0
    ? { descriptor: e }
    : { descriptor: n, values: { itemCount: r } };
}
function Bn(e) {
  let t = I(e?.to),
    n = I(e?.cc),
    r = I(e?.bcc),
    i = I(e?.note),
    a = e?.message_ids?.length ?? 0;
  return t == null && n == null && r == null && i == null && a === 0
    ? { descriptor: R.forward_emails_approval }
    : {
        descriptor: R.forward_emails_approvalWithContext,
        values: {
          bcc: r ?? ``,
          cc: n ?? ``,
          hasBcc: r == null ? `no` : `yes`,
          hasCc: n == null ? `no` : `yes`,
          hasNote: i == null ? `no` : `yes`,
          hasTo: t == null ? `no` : `yes`,
          itemCount: a,
          note: i ?? ``,
          to: t ?? ``,
        },
      };
}
function Vn(e) {
  let t = I(e?.name);
  return t == null
    ? { descriptor: R.create_label_approval }
    : {
        descriptor: R.create_label_approvalWithContext,
        values: {
          itemName: t,
          labelVisibility: e?.label_list_visibility ?? `labelShow`,
          messageVisibility: e?.message_list_visibility ?? `show`,
        },
      };
}
function Hn(e) {
  let t = I(e?.add_label_names?.join(`, `)),
    n = I(e?.remove_label_names?.join(`, `)),
    r = e?.message_ids?.length ?? 0;
  return t == null && n == null && r === 0
    ? { descriptor: R.apply_labels_to_emails_approval }
    : {
        descriptor: R.apply_labels_to_emails_approvalWithContext,
        values: {
          addedLabels: t ?? ``,
          hasAddedLabels: t == null ? `no` : `yes`,
          hasRemovedLabels: n == null ? `no` : `yes`,
          itemCount: r,
          removedLabels: n ?? ``,
        },
      };
}
function Un(e) {
  let t = I(e?.query),
    n = I(e?.label_name);
  return t == null && n == null
    ? { descriptor: R.bulk_label_matching_emails_approval }
    : {
        descriptor: R.bulk_label_matching_emails_approvalWithContext,
        values: {
          hasLabelName: n == null ? `no` : `yes`,
          hasQuery: t == null ? `no` : `yes`,
          labelName: n ?? ``,
          query: t ?? ``,
          shouldArchive: e?.archive === !0 ? `yes` : `no`,
        },
      };
}
function Wn({
  approval: e,
  getItemName: t,
  getMessages: n,
  preferRecipient: r = !1,
}) {
  let i = (e, i) => {
    let a = n();
    if (!e.hasInvocationContext || e.toolArguments == null)
      return e.intl.formatMessage(a.withoutContext[i]);
    let o = D({ maxLength: L, value: t(e.toolArguments) }),
      s = D({
        maxLength: L,
        value: e.toolArguments.to?.split(`,`).find((e) => e.trim().length > 0),
      });
    return o != null && s != null && a.withItemNameAndRecipient != null
      ? e.intl.formatMessage(a.withItemNameAndRecipient[i], {
          itemName: o,
          recipientName: s,
        })
      : s != null && (r || o == null)
        ? e.intl.formatMessage(a.withRecipient[i], { recipientName: s })
        : o == null
          ? e.intl.formatMessage(a.withoutContext[i])
          : e.intl.formatMessage(a.withContext[i], { itemName: o });
  };
  return {
    active: (e) => i(e, `active`),
    completed: (e) => i(e, `completed`),
    approval: e,
  };
}
var Gn, Kn, L, qn, Jn, Yn, Xn, Zn, Qn, R;
function $n() {
  return ($n = e(() => {
    (d(),
      c(),
      O(),
      (Gn = `gmail`),
      (Kn = 120),
      (L = 40),
      (qn = [
        `emails`,
        `messages`,
        `message_ids`,
        `email_ids`,
        `results`,
        `items`,
      ]),
      (Jn = r(p().trim().min(1).max(200))
        .optional()
        .catch(void 0)),
      (Yn = f({
        add_label_names: Jn,
        add_labels: Jn,
        archive: g()
          .optional()
          .catch(void 0),
        attachment_files: r(te([p(), f({}).strip()]))
          .optional()
          .catch(void 0),
        attachment_id: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        bcc: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        body: p()
          .trim()
          .min(1)
          .max(5e4)
          .optional()
          .catch(void 0),
        cc: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        draft_id: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        filename: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        id: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        id_type: t([`message`, `thread`])
          .optional()
          .catch(void 0),
        label_list_visibility: t([
          `labelShow`,
          `labelShowIfUnread`,
          `labelHide`,
        ])
          .optional()
          .catch(void 0),
        label_name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        label_ids: Jn,
        label_names: Jn,
        max_messages: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        max_results: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        message_ids: Jn,
        message_list_visibility: t([`show`, `hide`])
          .optional()
          .catch(void 0),
        name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        note: p()
          .trim()
          .min(1)
          .max(1e3)
          .optional()
          .catch(void 0),
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        remove_label_names: Jn,
        remove_labels: Jn,
        subject: p()
          .trim()
          .min(1)
          .max(300)
          .optional()
          .catch(void 0),
        to: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
      }).strip()),
      (Xn = {
        apply_labels_to_emails: E({
          getMessages: () => ({
            withoutContext: {
              active: R.apply_labels_to_emails_active,
              completed: R.apply_labels_to_emails_completed,
            },
            withContext: {
              active: R.apply_labels_to_emails_activeWithContext,
              completed: R.apply_labels_to_emails_completedWithContext,
            },
          }),
          getValue: ({ add_label_names: e, remove_label_names: t }) =>
            (e?.length ? e : t)?.join(`, `),
          maxPreviewLength: L,
          valueName: `target`,
          approval: Hn,
        }),
        archive_emails: w(
          () => ({
            active: R.archive_emails_active,
            completed: R.archive_emails_completed,
          }),
          (e) =>
            zn({
              fallback: R.archive_emails_approval,
              toolArguments: e,
              withCount: R.archive_emails_approvalWithCount,
            }),
        ),
        batch_modify_email: E({
          getMessages: () => ({
            withoutContext: {
              active: R.batch_modify_email_active,
              completed: R.batch_modify_email_completed,
            },
            withContext: {
              active: R.batch_modify_email_activeWithContext,
              completed: R.batch_modify_email_completedWithContext,
            },
          }),
          getValue: ({ add_labels: e, remove_labels: t }) =>
            (e?.length ? e : t)?.join(`, `),
          maxPreviewLength: L,
          valueName: `target`,
          approval: (e) =>
            zn({
              fallback: R.batch_modify_email_approval,
              toolArguments: e,
              withCount: R.batch_modify_email_approvalWithCount,
            }),
        }),
        batch_read_email: w(() => ({
          active: R.read_email_active,
          completed: R.read_email_completed,
        })),
        batch_read_email_threads: w(() => ({
          active: R.batch_read_email_threads_active,
          completed: R.batch_read_email_threads_completed,
        })),
        bulk_label_matching_emails: w(
          () => ({
            active: R.bulk_label_matching_emails_active,
            completed: R.bulk_label_matching_emails_completed,
          }),
          Un,
        ),
        create_draft: Wn({
          approval: (e) =>
            Rn({
              fallback: R.create_draft_approval,
              toolArguments: e,
              withContext: R.create_draft_approvalWithContext,
            }),
          getItemName: ({ subject: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: R.create_draft_active,
              completed: R.create_draft_completed,
            },
            withContext: {
              active: R.create_draft_activeWithContext,
              completed: R.create_draft_completedWithContext,
            },
            withRecipient: {
              active: R.create_draft_activeWithRecipient,
              completed: R.create_draft_completedWithRecipient,
            },
          }),
        }),
        create_label: T({
          getItemName: ({ name: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: R.create_label_active,
              completed: R.create_label_completed,
            },
            withContext: {
              active: R.create_label_activeWithContext,
              completed: R.create_label_completedWithContext,
            },
          }),
          maxPreviewLength: L,
          approval: Vn,
        }),
        delete_emails: w(
          () => ({
            active: R.delete_emails_active,
            completed: R.delete_emails_completed,
          }),
          (e) =>
            zn({
              fallback: R.delete_emails_approval,
              toolArguments: e,
              withCount: R.delete_emails_approvalWithCount,
            }),
        ),
        forward_emails: Wn({
          approval: Bn,
          getItemName: ({ note: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: R.forward_emails_active,
              completed: R.forward_emails_completed,
            },
            withContext: {
              active: R.forward_emails_activeWithContext,
              completed: R.forward_emails_completedWithContext,
            },
            withRecipient: {
              active: R.forward_emails_activeWithRecipient,
              completed: R.forward_emails_completedWithRecipient,
            },
          }),
          preferRecipient: !0,
        }),
        get_profile: w(() => ({
          active: R.get_profile_active,
          completed: R.get_profile_completed,
        })),
        get_recent_emails: w(() => ({
          active: R.get_recent_emails_active,
          completed: R.get_recent_emails_completed,
        })),
        list_drafts: w(() => ({
          active: R.list_drafts_active,
          completed: R.list_drafts_completed,
        })),
        list_labels: E({
          getMessages: () => ({
            withoutContext: {
              active: R.list_labels_active,
              completed: R.list_labels_completed,
            },
            withContext: {
              active: R.list_labels_activeWithContext,
              completed: R.list_labels_completedWithContext,
            },
          }),
          getValue: ({ label_names: e }) => e?.join(`, `),
          maxPreviewLength: L,
          valueName: `target`,
        }),
        read_attachment: T({
          getItemName: ({ filename: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: R.read_attachment_active,
              completed: R.read_attachment_completed,
            },
            withContext: {
              active: R.read_attachment_activeWithContext,
              completed: R.read_attachment_completedWithContext,
            },
          }),
          maxPreviewLength: L,
        }),
        read_email: w(() => ({
          active: R.read_email_active,
          completed: R.read_email_completed,
        })),
        read_email_thread: Yt({
          getMessages: () => ({
            completedCount: R.read_email_thread_completedCount,
            withoutContext: {
              active: R.read_email_thread_active,
              completed: R.read_email_thread_completed,
            },
            withContext: {
              active: R.read_email_thread_activeWithContext,
              completed: R.read_email_thread_completedWithContext,
            },
          }),
          preferredKeys: [`messages`, `emails`],
        }),
        search_email_ids: Xt({
          getMessages: () => ({
            completedCount: R.search_emails_completedCount,
            withoutContext: {
              active: R.search_emails_active,
              completed: R.search_emails_completed,
            },
            withContext: {
              active: R.search_emails_activeWithContext,
              completed: R.search_emails_completedWithContext,
            },
          }),
          getQuery: ({ query: e }) => e,
          maxPreviewLength: L,
          preferredKeys: qn,
          shouldIncludeResultCount: ({ max_results: e }) => e != null,
        }),
        search_emails: Xt({
          getMessages: () => ({
            completedCount: R.search_emails_completedCount,
            withoutContext: {
              active: R.search_emails_active,
              completed: R.search_emails_completed,
            },
            withContext: {
              active: R.search_emails_activeWithContext,
              completed: R.search_emails_completedWithContext,
            },
          }),
          getQuery: ({ query: e }) => e,
          maxPreviewLength: L,
          preferredKeys: qn,
          shouldIncludeResultCount: ({ max_results: e }) => e != null,
        }),
        send_draft: w(
          () => ({
            active: R.send_draft_active,
            completed: R.send_draft_completed,
          }),
          () => ({ descriptor: R.send_draft_approval }),
        ),
        send_email: Wn({
          approval: (e) =>
            Rn({
              fallback: R.send_email_approval,
              toolArguments: e,
              withContext: R.send_email_approvalWithContext,
            }),
          getItemName: ({ subject: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: R.send_email_active,
              completed: R.send_email_completed,
            },
            withContext: {
              active: R.send_email_activeWithContext,
              completed: R.send_email_completedWithContext,
            },
            withRecipient: {
              active: R.send_email_activeWithRecipient,
              completed: R.send_email_completedWithRecipient,
            },
            withItemNameAndRecipient: {
              active: R.send_email_activeWithItemNameAndRecipient,
              completed: R.send_email_completedWithItemNameAndRecipient,
            },
          }),
        }),
        update_draft: Wn({
          approval: (e) =>
            Rn({
              fallback: R.update_draft_approval,
              toolArguments: e,
              withContext: R.update_draft_approvalWithContext,
            }),
          getItemName: ({ subject: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: R.update_draft_active,
              completed: R.update_draft_completed,
            },
            withContext: {
              active: R.update_draft_activeWithContext,
              completed: R.update_draft_completedWithContext,
            },
            withRecipient: {
              active: R.update_draft_activeWithRecipient,
              completed: R.update_draft_completedWithRecipient,
            },
          }),
        }),
      }),
      (Zn = C({ appRegistryKey: Gn, toolArgumentsSchema: Yn, tools: Xn })),
      (Qn = qt({ toolArgumentsSchema: Yn, tools: Xn })),
      (R = h({
        apply_labels_to_emails_approval: {
          id: `localConversation.mcpToolApproval.gmail.apply_labels_to_emails.fallback`,
        },
        apply_labels_to_emails_approvalWithContext: {
          id: `localConversation.mcpToolApproval.gmail.apply_labels_to_emails.target`,
        },
        archive_emails_approval: {
          id: `localConversation.mcpToolApproval.gmail.archive_emails.fallback`,
        },
        archive_emails_approvalWithCount: {
          id: `localConversation.mcpToolApproval.gmail.archive_emails.count`,
        },
        batch_modify_email_approval: {
          id: `localConversation.mcpToolApproval.gmail.batch_modify_email.fallback`,
        },
        batch_modify_email_approvalWithCount: {
          id: `localConversation.mcpToolApproval.gmail.batch_modify_email.count`,
        },
        bulk_label_matching_emails_approval: {
          id: `localConversation.mcpToolApproval.gmail.bulk_label_matching_emails.fallback`,
        },
        bulk_label_matching_emails_approvalWithContext: {
          id: `localConversation.mcpToolApproval.gmail.bulk_label_matching_emails.context`,
        },
        create_draft_approval: {
          id: `localConversation.mcpToolApproval.gmail.create_draft.fallback`,
        },
        create_draft_approvalWithContext: {
          id: `localConversation.mcpToolApproval.gmail.create_draft.itemName`,
        },
        create_label_approval: {
          id: `localConversation.mcpToolApproval.gmail.create_label.fallback`,
        },
        create_label_approvalWithContext: {
          id: `localConversation.mcpToolApproval.gmail.create_label.itemName`,
        },
        delete_emails_approval: {
          id: `localConversation.mcpToolApproval.gmail.delete_emails.fallback`,
        },
        delete_emails_approvalWithCount: {
          id: `localConversation.mcpToolApproval.gmail.delete_emails.count`,
        },
        forward_emails_approval: {
          id: `localConversation.mcpToolApproval.gmail.forward_emails.fallback`,
        },
        forward_emails_approvalWithContext: {
          id: `localConversation.mcpToolApproval.gmail.forward_emails.recipient`,
        },
        send_draft_approval: {
          id: `localConversation.mcpToolApproval.gmail.send_draft.fallback`,
        },
        send_email_approval: {
          id: `localConversation.mcpToolApproval.gmail.send_email.fallback`,
        },
        send_email_approvalWithContext: {
          id: `localConversation.mcpToolApproval.gmail.send_email.item_and_recipient`,
        },
        update_draft_approval: {
          id: `localConversation.mcpToolApproval.gmail.update_draft.fallback`,
        },
        update_draft_approvalWithContext: {
          id: `localConversation.mcpToolApproval.gmail.update_draft.itemName`,
        },
        apply_labels_to_emails_active: {
          id: `localConversation.mcpToolActivity.gmail.apply_labels_to_emails.active`,
        },
        apply_labels_to_emails_completed: {
          id: `localConversation.mcpToolActivity.gmail.apply_labels_to_emails.completed`,
        },
        archive_emails_active: {
          id: `localConversation.mcpToolActivity.gmail.archive_emails.active`,
        },
        archive_emails_completed: {
          id: `localConversation.mcpToolActivity.gmail.archive_emails.completed`,
        },
        batch_modify_email_active: {
          id: `localConversation.mcpToolActivity.gmail.batch_modify_email.active`,
        },
        batch_modify_email_completed: {
          id: `localConversation.mcpToolActivity.gmail.batch_modify_email.completed`,
        },
        bulk_label_matching_emails_active: {
          id: `localConversation.mcpToolActivity.gmail.bulk_label_matching_emails.active`,
        },
        bulk_label_matching_emails_completed: {
          id: `localConversation.mcpToolActivity.gmail.bulk_label_matching_emails.completed`,
        },
        create_draft_active: {
          id: `localConversation.mcpToolActivity.gmail.create_draft.active`,
        },
        create_draft_completed: {
          id: `localConversation.mcpToolActivity.gmail.create_draft.completed`,
        },
        create_label_active: {
          id: `localConversation.mcpToolActivity.gmail.create_label.active`,
        },
        create_label_completed: {
          id: `localConversation.mcpToolActivity.gmail.create_label.completed`,
        },
        delete_emails_active: {
          id: `localConversation.mcpToolActivity.gmail.delete_emails.active`,
        },
        delete_emails_completed: {
          id: `localConversation.mcpToolActivity.gmail.delete_emails.completed`,
        },
        forward_emails_active: {
          id: `localConversation.mcpToolActivity.gmail.forward_emails.active`,
        },
        forward_emails_completed: {
          id: `localConversation.mcpToolActivity.gmail.forward_emails.completed`,
        },
        send_draft_active: {
          id: `localConversation.mcpToolActivity.gmail.send_draft.active`,
        },
        send_draft_completed: {
          id: `localConversation.mcpToolActivity.gmail.send_draft.completed`,
        },
        send_email_active: {
          id: `localConversation.mcpToolActivity.gmail.send_email.active`,
        },
        send_email_completed: {
          id: `localConversation.mcpToolActivity.gmail.send_email.completed`,
        },
        update_draft_active: {
          id: `localConversation.mcpToolActivity.gmail.update_draft.active`,
        },
        update_draft_completed: {
          id: `localConversation.mcpToolActivity.gmail.update_draft.completed`,
        },
        get_profile_active: {
          id: `localConversation.mcpToolActivity.gmail.get_profile.active`,
        },
        get_profile_completed: {
          id: `localConversation.mcpToolActivity.gmail.get_profile.completed`,
        },
        get_recent_emails_active: {
          id: `localConversation.mcpToolActivity.gmail.get_recent_emails.active`,
        },
        get_recent_emails_completed: {
          id: `localConversation.mcpToolActivity.gmail.get_recent_emails.completed`,
        },
        list_drafts_active: {
          id: `localConversation.mcpToolActivity.gmail.list_drafts.active`,
        },
        list_drafts_completed: {
          id: `localConversation.mcpToolActivity.gmail.list_drafts.completed`,
        },
        list_labels_active: {
          id: `localConversation.mcpToolActivity.gmail.list_labels.active`,
        },
        list_labels_completed: {
          id: `localConversation.mcpToolActivity.gmail.list_labels.completed`,
        },
        read_attachment_active: {
          id: `localConversation.mcpToolActivity.gmail.read_attachment.active`,
        },
        read_attachment_completed: {
          id: `localConversation.mcpToolActivity.gmail.read_attachment.completed`,
        },
        read_email_active: {
          id: `localConversation.mcpToolActivity.gmail.read_email.active`,
        },
        read_email_completed: {
          id: `localConversation.mcpToolActivity.gmail.read_email.completed`,
        },
        read_email_thread_active: {
          id: `localConversation.mcpToolActivity.gmail.read_email_thread.active`,
        },
        read_email_thread_completed: {
          id: `localConversation.mcpToolActivity.gmail.read_email_thread.completed`,
        },
        search_emails_active: {
          id: `localConversation.mcpToolActivity.gmail.search_emails.active`,
        },
        search_emails_completed: {
          id: `localConversation.mcpToolActivity.gmail.search_emails.completed`,
        },
        batch_read_email_threads_active: {
          id: `localConversation.mcpToolActivity.gmail.batch_read_email_threads.active`,
        },
        batch_read_email_threads_completed: {
          id: `localConversation.mcpToolActivity.gmail.batch_read_email_threads.completed`,
        },
        apply_labels_to_emails_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.apply_labels_to_emails.activeWithContext`,
        },
        apply_labels_to_emails_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.apply_labels_to_emails.completedWithContext`,
        },
        batch_modify_email_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.batch_modify_email.activeWithContext`,
        },
        batch_modify_email_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.batch_modify_email.completedWithContext`,
        },
        create_draft_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.create_draft.activeWithContext`,
        },
        create_draft_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.create_draft.completedWithContext`,
        },
        create_draft_activeWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.create_draft.activeWithRecipient`,
        },
        create_draft_completedWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.create_draft.completedWithRecipient`,
        },
        create_label_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.create_label.activeWithContext`,
        },
        create_label_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.create_label.completedWithContext`,
        },
        forward_emails_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.forward_emails.activeWithContext`,
        },
        forward_emails_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.forward_emails.completedWithContext`,
        },
        forward_emails_activeWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.forward_emails.activeWithRecipient`,
        },
        forward_emails_completedWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.forward_emails.completedWithRecipient`,
        },
        list_labels_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.list_labels.activeWithContext`,
        },
        list_labels_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.list_labels.completedWithContext`,
        },
        read_attachment_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.read_attachment.activeWithContext`,
        },
        read_attachment_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.read_attachment.completedWithContext`,
        },
        read_email_thread_activeWithContext: {
          id: `codex.mcpTool.gmail.readThreadEmails.active`,
        },
        read_email_thread_completedWithContext: {
          id: `codex.mcpTool.gmail.readThreadEmails.completed`,
        },
        read_email_thread_completedCount: {
          id: `codex.mcpTool.gmail.readThreadEmails.completedCount`,
        },
        search_emails_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.search_emails.activeWithContext`,
        },
        search_emails_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.search_emails.completedWithContext`,
        },
        search_emails_completedCount: {
          id: `codex.mcpTool.gmail.searchedEmailsCount`,
        },
        send_email_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.send_email.activeWithContext`,
        },
        send_email_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.send_email.completedWithContext`,
        },
        send_email_activeWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.send_email.activeWithRecipient`,
        },
        send_email_completedWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.send_email.completedWithRecipient`,
        },
        send_email_activeWithItemNameAndRecipient: {
          id: `localConversation.mcpToolActivity.gmail.send_email.activeWithItemNameAndRecipient`,
        },
        send_email_completedWithItemNameAndRecipient: {
          id: `localConversation.mcpToolActivity.gmail.send_email.completedWithItemNameAndRecipient`,
        },
        update_draft_activeWithContext: {
          id: `localConversation.mcpToolActivity.gmail.update_draft.activeWithContext`,
        },
        update_draft_completedWithContext: {
          id: `localConversation.mcpToolActivity.gmail.update_draft.completedWithContext`,
        },
        update_draft_activeWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.update_draft.activeWithRecipient`,
        },
        update_draft_completedWithRecipient: {
          id: `localConversation.mcpToolActivity.gmail.update_draft.completedWithRecipient`,
        },
      })));
  }))();
}
function er(e, { fallback: t, withContext: n }) {
  let r = D({ maxLength: or, value: e?.title }),
    i = tr(e?.start_time),
    a = tr(e?.end_time),
    o = e?.attendees?.join(`, `) ?? ``,
    s = e?.attendees_to_add?.join(`, `) ?? ``,
    c = e?.attendees_to_remove?.join(`, `) ?? ``;
  return r == null &&
    i == null &&
    a == null &&
    o.length === 0 &&
    s.length === 0 &&
    c.length === 0
    ? { descriptor: t }
    : {
        descriptor: n,
        values: {
          attendees: o,
          attendeesToAdd: s,
          attendeesToRemove: c,
          endTime: a ?? 0,
          hasAttendees: o.length > 0 ? `yes` : `no`,
          hasAttendeesToAdd: s.length > 0 ? `yes` : `no`,
          hasAttendeesToRemove: c.length > 0 ? `yes` : `no`,
          hasEndTime: a == null ? `no` : `yes`,
          hasStartTime: i == null ? `no` : `yes`,
          hasTitle: r == null ? `no` : `yes`,
          itemName: r ?? ``,
          startTime: i ?? 0,
        },
      };
}
function tr(e) {
  if (e == null) return null;
  let t = Date.parse(e);
  return Number.isFinite(t) ? t : null;
}
function nr() {
  let e = (e, t) => {
    let n = e.toolArguments?.event_ids?.length;
    return n == null || n === 0
      ? t === `active`
        ? e.intl.formatMessage(z.read_event_active)
        : e.intl.formatMessage(z.read_event_completed)
      : t === `active`
        ? e.intl.formatMessage(z.batch_read_event_activeWithCount, { count: n })
        : e.intl.formatMessage(z.batch_read_event_completedWithCount, {
            count: n,
          });
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function rr() {
  let e = (e, t) => {
    let n = e.toolArguments?.calendar_ids;
    if (n == null || n.length === 0)
      return t === `active`
        ? e.intl.formatMessage(z.get_availability_active)
        : e.intl.formatMessage(z.get_availability_completed);
    let r = n.filter((e) => e !== `primary` && e.includes(`@`));
    return r.length === 1
      ? t === `active`
        ? e.intl.formatMessage(z.get_availability_activeWithCalendar, {
            calendar: r[0],
          })
        : e.intl.formatMessage(z.get_availability_completedWithCalendar, {
            calendar: r[0],
          })
      : n.length > 1
        ? t === `active`
          ? e.intl.formatMessage(z.get_availability_activeWithCount, {
              count: n.length,
            })
          : e.intl.formatMessage(z.get_availability_completedWithCount, {
              count: n.length,
            })
        : t === `active`
          ? e.intl.formatMessage(z.get_availability_active)
          : e.intl.formatMessage(z.get_availability_completed);
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function ir() {
  let e = (e, t) => {
    let n = e.toolArguments?.response_status;
    if (n == null)
      return t === `active`
        ? e.intl.formatMessage(z.respond_event_active)
        : e.intl.formatMessage(z.respond_event_completed);
    let r = {
      accepted: {
        active: z.respond_event_acceptedActive,
        completed: z.respond_event_acceptedCompleted,
      },
      declined: {
        active: z.respond_event_declinedActive,
        completed: z.respond_event_declinedCompleted,
      },
      tentative: {
        active: z.respond_event_tentativeActive,
        completed: z.respond_event_tentativeCompleted,
      },
    };
    return e.intl.formatMessage(r[n][t]);
  };
  return {
    active: (t) => e(t, `active`),
    completed: (t) => e(t, `completed`),
    approval: (e) => {
      let t = e?.response_status;
      return t == null
        ? { descriptor: z.respond_event_approval }
        : {
            descriptor: {
              accepted: z.respond_event_approvalAccepted,
              declined: z.respond_event_approvalDeclined,
              tentative: z.respond_event_approvalTentative,
            }[t],
          };
    },
  };
}
var ar, or, sr, cr, lr, ur, z;
function dr() {
  return (dr = e(() => {
    (d(),
      c(),
      O(),
      (ar = `google calendar`),
      (or = 40),
      (sr = f({
        attendees: r(p().trim().min(1).max(320))
          .optional()
          .catch(void 0),
        attendees_to_add: r(p().trim().min(1).max(320))
          .optional()
          .catch(void 0),
        attendees_to_remove: r(p().trim().min(1).max(320))
          .optional()
          .catch(void 0),
        calendar_id: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        calendar_ids: r(p().trim().min(1))
          .optional()
          .catch(void 0),
        end_time: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        event_id: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        event_ids: r(p().trim().min(1))
          .optional()
          .catch(void 0),
        max_results: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        response_status: t([`accepted`, `declined`, `tentative`])
          .optional()
          .catch(void 0),
        response_timezone_str: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        start_time: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        time_max: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        time_min: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        timezone_str: p()
          .trim()
          .min(1)
          .optional()
          .catch(void 0),
        title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
      }).strip()),
      (cr = {
        batch_read_event: nr(),
        create_event: T({
          getItemName: ({ title: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: z.create_event_active,
              completed: z.create_event_completed,
            },
            withContext: {
              active: z.create_event_activeWithContext,
              completed: z.create_event_completedWithContext,
            },
          }),
          maxPreviewLength: or,
          approval: (e) =>
            er(e, {
              fallback: z.create_event_approval,
              withContext: z.create_event_approvalWithContext,
            }),
        }),
        delete_event: w(
          () => ({
            active: z.delete_event_active,
            completed: z.delete_event_completed,
          }),
          () => ({ descriptor: z.delete_event_approval }),
        ),
        fetch: w(() => ({
          active: z.fetch_active,
          completed: z.fetch_completed,
        })),
        get_availability: rr(),
        get_colors: w(() => ({
          active: z.get_colors_active,
          completed: z.get_colors_completed,
        })),
        get_profile: w(() => ({
          active: z.get_profile_active,
          completed: z.get_profile_completed,
        })),
        read_event: w(() => ({
          active: z.read_event_active,
          completed: z.read_event_completed,
        })),
        read_event_all_fields: w(() => ({
          active: z.read_event_all_fields_active,
          completed: z.read_event_all_fields_completed,
        })),
        respond_event: ir(),
        search: Xt({
          getMessages: () => ({
            completedCount: z.searched_events_completedCount,
            withoutContext: {
              active: z.search_active,
              completed: z.search_completed,
            },
            withContext: {
              active: z.search_activeWithContext,
              completed: z.search_completedWithContext,
            },
          }),
          getQuery: ({ query: e }) => e,
          maxPreviewLength: or,
          preferredKeys: [`events`, `results`, `items`],
          shouldIncludeResultCount: ({ max_results: e }) => e != null,
        }),
        search_events: Xt({
          getMessages: () => ({
            completedCount: z.searched_events_completedCount,
            withoutContext: {
              active: z.search_events_active,
              completed: z.search_events_completed,
            },
            withContext: {
              active: z.search_events_activeWithContext,
              completed: z.search_events_completedWithContext,
            },
          }),
          getQuery: ({ query: e }) => e,
          maxPreviewLength: or,
          preferredKeys: [`events`, `results`, `items`],
          shouldIncludeResultCount: ({ max_results: e }) => e != null,
        }),
        search_events_all_fields: w(() => ({
          active: z.search_events_active,
          completed: z.search_events_completed,
        })),
        update_event: T({
          getItemName: ({ title: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: z.update_event_active,
              completed: z.update_event_completed,
            },
            withContext: {
              active: z.update_event_activeWithContext,
              completed: z.update_event_completedWithContext,
            },
          }),
          maxPreviewLength: or,
          approval: (e) =>
            er(e, {
              fallback: z.update_event_approval,
              withContext: z.update_event_approvalWithContext,
            }),
        }),
      }),
      (lr = C({ appRegistryKey: ar, toolArgumentsSchema: sr, tools: cr })),
      (ur = qt({ toolArgumentsSchema: sr, tools: cr })),
      (z = h({
        create_event_approval: {
          id: `localConversation.mcpToolApproval.googleCalendar.create_event.fallback`,
        },
        create_event_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleCalendar.create_event.context`,
        },
        delete_event_approval: {
          id: `localConversation.mcpToolApproval.googleCalendar.delete_event.fallback`,
        },
        respond_event_approval: {
          id: `localConversation.mcpToolApproval.googleCalendar.respond_event.fallback`,
        },
        respond_event_approvalAccepted: {
          id: `localConversation.mcpToolApproval.googleCalendar.respond_event.accepted`,
        },
        respond_event_approvalDeclined: {
          id: `localConversation.mcpToolApproval.googleCalendar.respond_event.declined`,
        },
        respond_event_approvalTentative: {
          id: `localConversation.mcpToolApproval.googleCalendar.respond_event.tentative`,
        },
        update_event_approval: {
          id: `localConversation.mcpToolApproval.googleCalendar.update_event.fallback`,
        },
        update_event_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleCalendar.update_event.context`,
        },
        create_event_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.create_event.active`,
        },
        create_event_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.create_event.completed`,
        },
        delete_event_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.delete_event.active`,
        },
        delete_event_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.delete_event.completed`,
        },
        respond_event_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.respond_event.active`,
        },
        respond_event_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.respond_event.completed`,
        },
        update_event_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.update_event.active`,
        },
        update_event_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.update_event.completed`,
        },
        fetch_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.fetch.active`,
        },
        fetch_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.fetch.completed`,
        },
        get_availability_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.get_availability.active`,
        },
        get_availability_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.get_availability.completed`,
        },
        get_profile_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.get_profile.active`,
        },
        get_profile_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.get_profile.completed`,
        },
        read_event_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.read_event.active`,
        },
        read_event_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.read_event.completed`,
        },
        read_event_all_fields_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.read_event_all_fields.active`,
        },
        read_event_all_fields_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.read_event_all_fields.completed`,
        },
        search_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.search.active`,
        },
        search_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.search.completed`,
        },
        search_events_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.search_events.active`,
        },
        search_events_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.search_events.completed`,
        },
        get_colors_active: {
          id: `localConversation.mcpToolActivity.googleCalendar.get_colors.active`,
        },
        get_colors_completed: {
          id: `localConversation.mcpToolActivity.googleCalendar.get_colors.completed`,
        },
        create_event_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.create_event.activeWithContext`,
        },
        create_event_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.create_event.completedWithContext`,
        },
        update_event_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.update_event.activeWithContext`,
        },
        update_event_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.update_event.completedWithContext`,
        },
        search_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.search.activeWithContext`,
        },
        search_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.search.completedWithContext`,
        },
        search_events_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.search_events.activeWithContext`,
        },
        search_events_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleCalendar.search_events.completedWithContext`,
        },
        searched_events_completedCount: {
          id: `codex.mcpTool.googleCalendar.searchedEventsCount`,
        },
        batch_read_event_activeWithCount: {
          id: `codex.mcpTool.googleCalendar.readEventsCount.active`,
        },
        batch_read_event_completedWithCount: {
          id: `codex.mcpTool.googleCalendar.readEventsCount.completed`,
        },
        get_availability_activeWithCalendar: {
          id: `codex.mcpTool.googleCalendar.checkedAvailabilityFor.active`,
        },
        get_availability_completedWithCalendar: {
          id: `codex.mcpTool.googleCalendar.checkedAvailabilityFor.completed`,
        },
        get_availability_activeWithCount: {
          id: `codex.mcpTool.googleCalendar.checkedAvailabilityAcross.active`,
        },
        get_availability_completedWithCount: {
          id: `codex.mcpTool.googleCalendar.checkedAvailabilityAcross.completed`,
        },
        respond_event_acceptedActive: {
          id: `codex.mcpTool.googleCalendar.acceptingEvent`,
        },
        respond_event_acceptedCompleted: {
          id: `codex.mcpTool.googleCalendar.acceptedEvent`,
        },
        respond_event_declinedActive: {
          id: `codex.mcpTool.googleCalendar.decliningEvent`,
        },
        respond_event_declinedCompleted: {
          id: `codex.mcpTool.googleCalendar.declinedEvent`,
        },
        respond_event_tentativeActive: {
          id: `codex.mcpTool.googleCalendar.markingEventTentative`,
        },
        respond_event_tentativeCompleted: {
          id: `codex.mcpTool.googleCalendar.markedEventTentative`,
        },
      })));
  }))();
}
function fr(e, { fallback: t, withItemName: n }) {
  let r = D({
    maxLength: B,
    value:
      e?.title ??
      e?.name ??
      e?.filename ??
      e?.file_name ??
      e?.source_file?.file_name ??
      e?.file_uri?.file_name,
  });
  return r == null
    ? { descriptor: t }
    : { descriptor: n, values: { itemName: r } };
}
function pr(e, { fallback: t, withUrl: n }) {
  let r = vr(e);
  return r == null ? { descriptor: t } : { descriptor: n, url: r };
}
function mr(e) {
  let t = D({ maxLength: B, value: e?.new_title }),
    n = vr(e);
  return t == null || n == null
    ? { descriptor: V.copy_file_approval }
    : {
        descriptor: V.copy_file_approvalWithContext,
        url: n,
        values: { itemName: t },
      };
}
function hr(e) {
  let t = D({ maxLength: B, value: e?.title }),
    n = e?.template_presentation_url;
  return (
    n == null &&
      e?.template_presentation_id != null &&
      (n = `https://docs.google.com/presentation/d/${e.template_presentation_id}/edit`),
    t == null || n == null
      ? { descriptor: V.create_presentation_from_template_approval }
      : {
          descriptor: V.create_presentation_from_template_approvalWithContext,
          url: n,
          values: { itemName: t },
        }
  );
}
function gr(e) {
  let t = D({ maxLength: B, value: e?.source_sheet_name }),
    n = D({ maxLength: B, value: e?.new_file_name });
  return t == null || n == null
    ? { descriptor: V.duplicate_sheet_in_new_spreadsheet_approval }
    : {
        descriptor: V.duplicate_sheet_in_new_spreadsheet_approvalWithContext,
        values: { sourceSheetName: t, newFileName: n },
      };
}
function _r(e) {
  let t = vr(e),
    n = e?.permission;
  if (e == null || t == null || n == null)
    return { descriptor: V.share_file_approval };
  if (e.anyone_at_company === !0)
    return {
      descriptor: V.share_file_approvalWithCompanyAndPermission,
      url: t,
      values: { permission: n },
    };
  let r = D({ maxLength: B, value: e.user_email });
  return r == null
    ? { descriptor: V.share_file_approval }
    : {
        descriptor: V.share_file_approvalWithRecipientAndPermission,
        url: t,
        values: { permission: n, recipientName: r },
      };
}
function vr(e) {
  let t =
    e?.url ?? e?.document_url ?? e?.presentation_url ?? e?.spreadsheet_url;
  if (t != null) return t;
  if (e?.document_id != null)
    return `https://docs.google.com/document/d/${e.document_id}/edit`;
  if (e?.presentation_id != null)
    return `https://docs.google.com/presentation/d/${e.presentation_id}/edit`;
  if (e?.spreadsheet_id != null)
    return `https://docs.google.com/spreadsheets/d/${e.spreadsheet_id}/edit`;
  let n = e?.fileId ?? e?.id;
  if (n != null) {
    let e = Tr.parse(n);
    return e == null ? Er.parse(n) : `https://drive.google.com/file/d/${e}`;
  }
}
function yr() {
  return {
    active: ({ intl: e }) => e.formatMessage(V.list_folder_active),
    completed: (e) => {
      if (!e.hasInvocationContext || e.toolArguments?.top_k == null)
        return e.intl.formatMessage(V.list_folder_completed);
      let t = Sr(e.toolResult);
      return t == null
        ? e.intl.formatMessage(V.list_folder_completed)
        : e.intl.formatMessage(V.list_folder_completedCount, { count: t });
    },
  };
}
function br() {
  return {
    active: ({ intl: e }) => e.formatMessage(V.recent_documents_active),
    completed: (e) => {
      if (!e.hasInvocationContext || e.toolArguments?.top_k == null)
        return e.intl.formatMessage(V.recent_documents_completed);
      let t = Sr(e.toolResult);
      return t == null
        ? e.intl.formatMessage(V.recent_documents_completed)
        : e.intl.formatMessage(V.recent_documents_completedCount, { count: t });
    },
  };
}
function xr(e) {
  return {
    active: ({ intl: t }) => t.formatMessage(e().active),
    completed: ({ intl: t, toolResult: n }) => {
      let r = D({ maxLength: B, value: Ze(Ht(n))?.title ?? void 0 }),
        i = e();
      return r == null
        ? t.formatMessage(i.completed)
        : t.formatMessage(i.completedWithContext, { itemName: r });
    },
  };
}
function Sr(e) {
  return Vt({ preferredKeys: wr, toolResult: e });
}
var Cr, B, wr, Tr, Er, Dr, Or, kr, Ar, jr, V;
function Mr() {
  return (Mr = e(() => {
    (d(),
      c(),
      $e(),
      Kt(),
      O(),
      (Cr = `google drive`),
      (B = 40),
      (wr = [`documents`, `files`, `items`, `results`]),
      (Tr = p()
        .trim()
        .min(5)
        .max(200)
        .regex(/^[a-zA-Z0-9_-]+$/)
        .optional()
        .catch(void 0)),
      (Er = p()
        .trim()
        .min(1)
        .max(500)
        .pipe(
          u({
            protocol: /^https$/,
            hostname: /^(?:www\.)?(?:docs|drive)\.google\.com$/i,
          }),
        )
        .optional()
        .catch(void 0)),
      (Dr = f({
        file_name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
      })
        .strip()
        .optional()
        .catch(void 0)),
      (Or = f({
        anyone_at_company: g()
          .optional()
          .catch(void 0),
        document_id: Tr,
        document_url: Er,
        email: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        fileId: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        file_name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        file_uri: Dr,
        filename: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        id: Tr,
        name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        new_file_name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        new_title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        permission: t([`reader`, `writer`, `commenter`, `owner`])
          .optional()
          .catch(void 0),
        presentation_id: Tr,
        presentation_url: Er,
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        range: p()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .catch(void 0),
        ranges: r(p().trim().min(1).max(100))
          .min(1)
          .max(100)
          .optional()
          .catch(void 0),
        source_file: Dr,
        source_sheet_name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        spreadsheet_id: Tr,
        spreadsheet_url: Er,
        template_presentation_id: Tr,
        template_presentation_url: Er,
        title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        top_k: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        url: Er,
        user_email: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
      }).strip()),
      (kr = {
        create_file: T({
          getItemName: ({ title: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: V.create_file_active,
              completed: V.create_file_completed,
            },
            withContext: {
              active: V.create_file_activeWithContext,
              completed: V.create_file_completedWithContext,
            },
          }),
          maxPreviewLength: B,
          approval: (e) =>
            fr(e, {
              fallback: V.create_file_approval,
              withItemName: V.create_file_approvalWithContext,
            }),
        }),
        copy_file: T({
          getItemName: ({ new_title: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: V.copy_file_active,
              completed: V.copy_file_completed,
            },
            withContext: {
              active: V.copy_file_activeWithContext,
              completed: V.copy_file_completedWithContext,
            },
          }),
          maxPreviewLength: B,
          approval: mr,
        }),
        create_folder: T({
          getItemName: ({ name: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: V.create_folder_active,
              completed: V.create_folder_completed,
            },
            withContext: {
              active: V.create_folder_activeWithContext,
              completed: V.create_folder_completedWithContext,
            },
          }),
          maxPreviewLength: B,
          approval: (e) =>
            fr(e, {
              fallback: V.create_folder_approval,
              withItemName: V.create_folder_approvalWithContext,
            }),
        }),
        create_presentation_from_template: T({
          getItemName: ({ title: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: V.create_presentation_from_template_active,
              completed: V.create_presentation_from_template_completed,
            },
            withContext: {
              active: V.create_presentation_from_template_activeWithContext,
              completed:
                V.create_presentation_from_template_completedWithContext,
            },
          }),
          maxPreviewLength: B,
          approval: hr,
        }),
        delete_file: w(
          () => ({
            active: V.delete_file_active,
            completed: V.delete_file_completed,
          }),
          (e) =>
            pr(e, {
              fallback: V.delete_file_approval,
              withUrl: V.delete_file_approvalWithContext,
            }),
        ),
        download_file: w(() => ({
          active: V.download_file_active,
          completed: V.download_file_completed,
        })),
        duplicate_sheet_in_new_spreadsheet: w(
          () => ({
            active: V.duplicate_sheet_in_new_spreadsheet_active,
            completed: V.duplicate_sheet_in_new_spreadsheet_completed,
          }),
          gr,
        ),
        export_file: w(() => ({
          active: V.export_file_active,
          completed: V.export_file_completed,
        })),
        import_document: w(
          () => ({
            active: V.import_document_active,
            completed: V.import_document_completed,
          }),
          (e) =>
            fr(e, {
              fallback: V.import_document_approval,
              withItemName: V.import_document_approvalWithContext,
            }),
        ),
        import_presentation: T({
          getItemName: ({ title: e }) => e,
          getMessages: () => ({
            withoutContext: {
              active: V.import_presentation_active,
              completed: V.import_presentation_completed,
            },
            withContext: {
              active: V.import_presentation_activeWithContext,
              completed: V.import_presentation_completedWithContext,
            },
          }),
          maxPreviewLength: B,
          approval: (e) =>
            fr(e, {
              fallback: V.import_presentation_approval,
              withItemName: V.import_presentation_approvalWithContext,
            }),
        }),
        import_spreadsheet: w(
          () => ({
            active: V.import_spreadsheet_active,
            completed: V.import_spreadsheet_completed,
          }),
          (e) =>
            fr(e, {
              fallback: V.import_spreadsheet_approval,
              withItemName: V.import_spreadsheet_approvalWithContext,
            }),
        ),
        list_drives: w(() => ({
          active: V.list_drives_active,
          completed: V.list_drives_completed,
        })),
        list_file_revisions: w(() => ({
          active: V.list_file_revisions_active,
          completed: V.list_file_revisions_completed,
        })),
        list_folder: yr(),
        recent_documents: br(),
        get_document: xr(() => ({
          active: V.get_document_active,
          completed: V.get_document_completed,
          completedWithContext: V.get_document_completedWithContext,
        })),
        get_document_comments: w(() => ({
          active: V.get_document_comments_active,
          completed: V.get_document_comments_completed,
        })),
        get_document_tables: w(() => ({
          active: V.get_document_tables_active,
          completed: V.get_document_tables_completed,
        })),
        get_document_text: w(() => ({
          active: V.get_document_text_active,
          completed: V.get_document_text_completed,
        })),
        get_file_comments: w(() => ({
          active: V.get_file_comments_active,
          completed: V.get_file_comments_completed,
        })),
        get_file_metadata: xr(() => ({
          active: V.get_file_metadata_active,
          completed: V.get_file_metadata_completed,
          completedWithContext: V.get_file_metadata_completedWithContext,
        })),
        fetch_file_revision: w(() => ({
          active: V.fetch_file_revision_active,
          completed: V.fetch_file_revision_completed,
        })),
        oai_admin_fetch: w(() => ({
          active: V.oai_admin_fetch_active,
          completed: V.oai_admin_fetch_completed,
        })),
        fetch: xr(() => ({
          active: V.fetch_active,
          completed: V.fetch_completed,
          completedWithContext: V.fetch_completedWithContext,
        })),
        get_presentation: xr(() => ({
          active: V.get_presentation_active,
          completed: V.get_presentation_completed,
          completedWithContext: V.get_presentation_completedWithContext,
        })),
        get_presentation_comments: w(() => ({
          active: V.get_presentation_comments_active,
          completed: V.get_presentation_comments_completed,
        })),
        get_presentation_outline: w(() => ({
          active: V.get_presentation_outline_active,
          completed: V.get_presentation_outline_completed,
        })),
        get_presentation_tables: w(() => ({
          active: V.get_presentation_tables_active,
          completed: V.get_presentation_tables_completed,
        })),
        get_presentation_text: w(() => ({
          active: V.get_presentation_text_active,
          completed: V.get_presentation_text_completed,
        })),
        get_profile: w(() => ({
          active: V.get_profile_active,
          completed: V.get_profile_completed,
        })),
        get_slide: w(() => ({
          active: V.get_slide_active,
          completed: V.get_slide_completed,
        })),
        get_slide_thumbnail: w(() => ({
          active: V.get_slide_thumbnail_active,
          completed: V.get_slide_thumbnail_completed,
        })),
        get_spreadsheet_cells: E({
          getMessages: () => ({
            withoutContext: {
              active: V.get_spreadsheet_cells_active,
              completed: V.get_spreadsheet_cells_completed,
            },
            withContext: {
              active: V.get_spreadsheet_cells_activeWithContext,
              completed: V.get_spreadsheet_cells_completedWithContext,
            },
          }),
          getValue: ({ ranges: e }) => e?.join(`, `),
          maxPreviewLength: B,
          valueName: `target`,
        }),
        get_spreadsheet_comments: w(() => ({
          active: V.get_spreadsheet_comments_active,
          completed: V.get_spreadsheet_comments_completed,
        })),
        get_spreadsheet_metadata: xr(() => ({
          active: V.get_spreadsheet_metadata_active,
          completed: V.get_spreadsheet_metadata_completed,
          completedWithContext: V.get_spreadsheet_metadata_completedWithContext,
        })),
        get_spreadsheet_range: E({
          getMessages: () => ({
            withoutContext: {
              active: V.get_spreadsheet_range_active,
              completed: V.get_spreadsheet_range_completed,
            },
            withContext: {
              active: V.get_spreadsheet_range_activeWithContext,
              completed: V.get_spreadsheet_range_completedWithContext,
            },
          }),
          getValue: ({ range: e }) => e,
          maxPreviewLength: B,
          valueName: `target`,
        }),
        get_document_paragraph_range: w(() => ({
          active: V.get_document_paragraph_range_active,
          completed: V.get_document_paragraph_range_completed,
        })),
        find_document_text_range: w(() => ({
          active: V.find_document_text_range_active,
          completed: V.find_document_text_range_completed,
        })),
        oai_admin_search: w(() => ({
          active: V.oai_admin_search_active,
          completed: V.oai_admin_search_completed,
        })),
        search: E({
          getMessages: () => ({
            withoutContext: {
              active: V.search_active,
              completed: V.search_completed,
            },
            withContext: {
              active: V.search_activeWithContext,
              completed: V.search_completedWithContext,
            },
          }),
          getValue: ({ query: e }) => e,
          maxPreviewLength: B,
          valueName: `query`,
        }),
        search_spreadsheet_rows: E({
          getMessages: () => ({
            withoutContext: {
              active: V.search_spreadsheet_rows_active,
              completed: V.search_spreadsheet_rows_completed,
            },
            withContext: {
              active: V.search_spreadsheet_rows_activeWithContext,
              completed: V.search_spreadsheet_rows_completedWithContext,
            },
          }),
          getValue: ({ query: e }) => e,
          maxPreviewLength: B,
          valueName: `query`,
        }),
        batch_update_document: w(
          () => ({
            active: V.batch_update_document_active,
            completed: V.batch_update_document_completed,
          }),
          (e) =>
            pr(e, {
              fallback: V.batch_update_document_approval,
              withUrl: V.batch_update_document_approvalWithContext,
            }),
        ),
        update_file: w(
          () => ({
            active: V.update_file_active,
            completed: V.update_file_completed,
          }),
          (e) =>
            pr(e, {
              fallback: V.update_file_approval,
              withUrl: V.update_file_approvalWithContext,
            }),
        ),
        share_file: E({
          getMessages: () => ({
            withoutContext: {
              active: V.share_file_active,
              completed: V.share_file_completed,
            },
            withContext: {
              active: V.share_file_activeWithRecipient,
              completed: V.share_file_completedWithRecipient,
            },
          }),
          getValue: ({ user_email: e }) => e,
          maxPreviewLength: B,
          valueName: `recipientName`,
          approval: _r,
        }),
        bulk_update_file_comments: w(
          () => ({
            active: V.bulk_update_file_comments_active,
            completed: V.bulk_update_file_comments_completed,
          }),
          (e) =>
            pr(e, {
              fallback: V.bulk_update_file_comments_approval,
              withUrl: V.bulk_update_file_comments_approvalWithContext,
            }),
        ),
        batch_update_presentation: w(
          () => ({
            active: V.batch_update_presentation_active,
            completed: V.batch_update_presentation_completed,
          }),
          (e) =>
            pr(e, {
              fallback: V.batch_update_presentation_approval,
              withUrl: V.batch_update_presentation_approvalWithContext,
            }),
        ),
        batch_update_spreadsheet: w(
          () => ({
            active: V.batch_update_spreadsheet_active,
            completed: V.batch_update_spreadsheet_completed,
          }),
          (e) =>
            pr(e, {
              fallback: V.batch_update_spreadsheet_approval,
              withUrl: V.batch_update_spreadsheet_approvalWithContext,
            }),
        ),
        upload_file: w(
          () => ({
            active: V.upload_file_active,
            completed: V.upload_file_completed,
          }),
          (e) =>
            fr(e, {
              fallback: V.upload_file_approval,
              withItemName: V.upload_file_approvalWithContext,
            }),
        ),
      }),
      (Ar = C({ appRegistryKey: Cr, toolArgumentsSchema: Or, tools: kr })),
      (jr = qt({ toolArgumentsSchema: Or, tools: kr })),
      (V = h({
        create_file_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.create_file.fallback`,
        },
        create_file_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.create_file.context`,
        },
        create_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.create_file.active`,
        },
        create_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.create_file.completed`,
        },
        create_file_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.create_file.activeWithContext`,
        },
        create_file_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.create_file.completedWithContext`,
        },
        copy_file_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.copy_file.fallback`,
        },
        copy_file_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.copy_file.context`,
        },
        copy_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.copy_file.active`,
        },
        copy_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.copy_file.completed`,
        },
        copy_file_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.copy_file.activeWithContext`,
        },
        copy_file_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.copy_file.completedWithContext`,
        },
        create_folder_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.create_folder.fallback`,
        },
        create_folder_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.create_folder.context`,
        },
        create_folder_active: {
          id: `localConversation.mcpToolActivity.googleDrive.create_folder.active`,
        },
        create_folder_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.create_folder.completed`,
        },
        create_folder_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.create_folder.activeWithContext`,
        },
        create_folder_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.create_folder.completedWithContext`,
        },
        create_presentation_from_template_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.create_presentation_from_template.fallback`,
        },
        create_presentation_from_template_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.create_presentation_from_template.context`,
        },
        create_presentation_from_template_active: {
          id: `localConversation.mcpToolActivity.googleDrive.create_presentation_from_template.active`,
        },
        create_presentation_from_template_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.create_presentation_from_template.completed`,
        },
        create_presentation_from_template_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.create_presentation_from_template.activeWithContext`,
        },
        create_presentation_from_template_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.create_presentation_from_template.completedWithContext`,
        },
        delete_file_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.delete_file.fallback`,
        },
        delete_file_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.delete_file.context`,
        },
        delete_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.delete_file.active`,
        },
        delete_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.delete_file.completed`,
        },
        download_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.download_file.active`,
        },
        download_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.download_file.completed`,
        },
        duplicate_sheet_in_new_spreadsheet_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.duplicate_sheet_in_new_spreadsheet.fallback`,
        },
        duplicate_sheet_in_new_spreadsheet_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.duplicate_sheet_in_new_spreadsheet.context`,
        },
        duplicate_sheet_in_new_spreadsheet_active: {
          id: `localConversation.mcpToolActivity.googleDrive.duplicate_sheet_in_new_spreadsheet.active`,
        },
        duplicate_sheet_in_new_spreadsheet_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.duplicate_sheet_in_new_spreadsheet.completed`,
        },
        export_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.export_file.active`,
        },
        export_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.export_file.completed`,
        },
        import_document_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.import_document.fallback`,
        },
        import_document_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.import_document.context`,
        },
        import_document_active: {
          id: `localConversation.mcpToolActivity.googleDrive.import_document.active`,
        },
        import_document_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.import_document.completed`,
        },
        import_presentation_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.import_presentation.fallback`,
        },
        import_presentation_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.import_presentation.context`,
        },
        import_presentation_active: {
          id: `localConversation.mcpToolActivity.googleDrive.import_presentation.active`,
        },
        import_presentation_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.import_presentation.completed`,
        },
        import_presentation_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.import_presentation.activeWithContext`,
        },
        import_presentation_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.import_presentation.completedWithContext`,
        },
        import_spreadsheet_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.import_spreadsheet.fallback`,
        },
        import_spreadsheet_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.import_spreadsheet.context`,
        },
        import_spreadsheet_active: {
          id: `localConversation.mcpToolActivity.googleDrive.import_spreadsheet.active`,
        },
        import_spreadsheet_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.import_spreadsheet.completed`,
        },
        list_drives_active: {
          id: `localConversation.mcpToolActivity.googleDrive.list_drives.active`,
        },
        list_drives_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.list_drives.completed`,
        },
        list_file_revisions_active: {
          id: `localConversation.mcpToolActivity.googleDrive.list_file_revisions.active`,
        },
        list_file_revisions_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.list_file_revisions.completed`,
        },
        list_folder_active: {
          id: `localConversation.mcpToolActivity.googleDrive.list_folder.active`,
        },
        list_folder_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.list_folder.completed`,
        },
        list_folder_completedCount: {
          id: `codex.mcpTool.googleDrive.listedFolderItemsCount`,
        },
        recent_documents_active: {
          id: `localConversation.mcpToolActivity.googleDrive.recent_documents.active`,
        },
        recent_documents_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.recent_documents.completed`,
        },
        recent_documents_completedCount: {
          id: `codex.mcpTool.googleDrive.gotRecentDocumentsCount`,
        },
        get_document_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document.active`,
        },
        get_document_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document.completed`,
        },
        get_document_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document.completedWithContext`,
        },
        get_document_comments_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_comments.active`,
        },
        get_document_comments_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_comments.completed`,
        },
        get_document_tables_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_tables.active`,
        },
        get_document_tables_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_tables.completed`,
        },
        get_document_text_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_text.active`,
        },
        get_document_text_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_text.completed`,
        },
        get_file_comments_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_file_comments.active`,
        },
        get_file_comments_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_file_comments.completed`,
        },
        get_file_metadata_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_file_metadata.active`,
        },
        get_file_metadata_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_file_metadata.completed`,
        },
        get_file_metadata_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_file_metadata.completedWithContext`,
        },
        fetch_file_revision_active: {
          id: `localConversation.mcpToolActivity.googleDrive.fetch_file_revision.active`,
        },
        fetch_file_revision_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.fetch_file_revision.completed`,
        },
        oai_admin_fetch_active: {
          id: `localConversation.mcpToolActivity.googleDrive.oai_admin_fetch.active`,
        },
        oai_admin_fetch_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.oai_admin_fetch.completed`,
        },
        fetch_active: {
          id: `localConversation.mcpToolActivity.googleDrive.fetch.active`,
        },
        fetch_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.fetch.completed`,
        },
        fetch_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.fetch.completedWithContext`,
        },
        get_presentation_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation.active`,
        },
        get_presentation_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation.completed`,
        },
        get_presentation_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation.completedWithContext`,
        },
        get_presentation_comments_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_comments.active`,
        },
        get_presentation_comments_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_comments.completed`,
        },
        get_presentation_outline_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_outline.active`,
        },
        get_presentation_outline_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_outline.completed`,
        },
        get_presentation_tables_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_tables.active`,
        },
        get_presentation_tables_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_tables.completed`,
        },
        get_presentation_text_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_text.active`,
        },
        get_presentation_text_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_presentation_text.completed`,
        },
        get_profile_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_profile.active`,
        },
        get_profile_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_profile.completed`,
        },
        get_slide_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_slide.active`,
        },
        get_slide_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_slide.completed`,
        },
        get_slide_thumbnail_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_slide_thumbnail.active`,
        },
        get_slide_thumbnail_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_slide_thumbnail.completed`,
        },
        get_spreadsheet_cells_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_cells.active`,
        },
        get_spreadsheet_cells_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_cells.completed`,
        },
        get_spreadsheet_cells_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_cells.activeWithContext`,
        },
        get_spreadsheet_cells_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_cells.completedWithContext`,
        },
        get_spreadsheet_comments_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_comments.active`,
        },
        get_spreadsheet_comments_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_comments.completed`,
        },
        get_spreadsheet_metadata_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_metadata.active`,
        },
        get_spreadsheet_metadata_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_metadata.completed`,
        },
        get_spreadsheet_metadata_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_metadata.completedWithContext`,
        },
        get_spreadsheet_range_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_range.active`,
        },
        get_spreadsheet_range_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_range.completed`,
        },
        get_spreadsheet_range_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_range.activeWithContext`,
        },
        get_spreadsheet_range_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.get_spreadsheet_range.completedWithContext`,
        },
        get_document_paragraph_range_active: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_paragraph_range.active`,
        },
        get_document_paragraph_range_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.get_document_paragraph_range.completed`,
        },
        find_document_text_range_active: {
          id: `localConversation.mcpToolActivity.googleDrive.find_document_text_range.active`,
        },
        find_document_text_range_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.find_document_text_range.completed`,
        },
        oai_admin_search_active: {
          id: `localConversation.mcpToolActivity.googleDrive.oai_admin_search.active`,
        },
        oai_admin_search_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.oai_admin_search.completed`,
        },
        search_active: {
          id: `localConversation.mcpToolActivity.googleDrive.search.active`,
        },
        search_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.search.completed`,
        },
        search_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.search.activeWithContext`,
        },
        search_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.search.completedWithContext`,
        },
        search_spreadsheet_rows_active: {
          id: `localConversation.mcpToolActivity.googleDrive.search_spreadsheet_rows.active`,
        },
        search_spreadsheet_rows_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.search_spreadsheet_rows.completed`,
        },
        search_spreadsheet_rows_activeWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.search_spreadsheet_rows.activeWithContext`,
        },
        search_spreadsheet_rows_completedWithContext: {
          id: `localConversation.mcpToolActivity.googleDrive.search_spreadsheet_rows.completedWithContext`,
        },
        batch_update_document_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.batch_update_document.fallback`,
        },
        batch_update_document_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.batch_update_document.context`,
        },
        batch_update_document_active: {
          id: `localConversation.mcpToolActivity.googleDrive.batch_update_document.active`,
        },
        batch_update_document_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.batch_update_document.completed`,
        },
        update_file_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.update_file.fallback`,
        },
        update_file_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.update_file.context`,
        },
        update_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.update_file.active`,
        },
        update_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.update_file.completed`,
        },
        share_file_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.share_file.fallback`,
        },
        share_file_approvalWithRecipientAndPermission: {
          id: `localConversation.mcpToolApproval.googleDrive.share_file.recipientAndPermission`,
        },
        share_file_approvalWithCompanyAndPermission: {
          id: `localConversation.mcpToolApproval.googleDrive.share_file.companyAndPermission`,
        },
        share_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.share_file.active`,
        },
        share_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.share_file.completed`,
        },
        share_file_activeWithRecipient: {
          id: `localConversation.mcpToolActivity.googleDrive.share_file.activeWithRecipient`,
        },
        share_file_completedWithRecipient: {
          id: `localConversation.mcpToolActivity.googleDrive.share_file.completedWithRecipient`,
        },
        bulk_update_file_comments_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.bulk_update_file_comments.fallback`,
        },
        bulk_update_file_comments_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.bulk_update_file_comments.context`,
        },
        bulk_update_file_comments_active: {
          id: `localConversation.mcpToolActivity.googleDrive.bulk_update_file_comments.active`,
        },
        bulk_update_file_comments_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.bulk_update_file_comments.completed`,
        },
        batch_update_presentation_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.batch_update_presentation.fallback`,
        },
        batch_update_presentation_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.batch_update_presentation.context`,
        },
        batch_update_presentation_active: {
          id: `localConversation.mcpToolActivity.googleDrive.batch_update_presentation.active`,
        },
        batch_update_presentation_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.batch_update_presentation.completed`,
        },
        batch_update_spreadsheet_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.batch_update_spreadsheet.fallback`,
        },
        batch_update_spreadsheet_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.batch_update_spreadsheet.context`,
        },
        batch_update_spreadsheet_active: {
          id: `localConversation.mcpToolActivity.googleDrive.batch_update_spreadsheet.active`,
        },
        batch_update_spreadsheet_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.batch_update_spreadsheet.completed`,
        },
        upload_file_approval: {
          id: `localConversation.mcpToolApproval.googleDrive.upload_file.fallback`,
        },
        upload_file_approvalWithContext: {
          id: `localConversation.mcpToolApproval.googleDrive.upload_file.context`,
        },
        upload_file_active: {
          id: `localConversation.mcpToolActivity.googleDrive.upload_file.active`,
        },
        upload_file_completed: {
          id: `localConversation.mcpToolActivity.googleDrive.upload_file.completed`,
        },
      })));
  }))();
}
function Nr({ toolArguments: e, toolKey: t }) {
  let n = si[t];
  if (n == null) return null;
  let r = oi.safeParse(e);
  return n(r.success ? r.data : null);
}
function Pr(e) {
  let t = H(e?.filename);
  return {
    descriptor: K.create_attachment_approval,
    values: { filename: t ?? ``, hasFilename: t == null ? `no` : `yes` },
  };
}
function Fr(e) {
  let t = H(e?.name);
  return {
    descriptor: K.create_issue_label_approval,
    values: { hasName: t == null ? `no` : `yes`, name: t ?? `` },
  };
}
function Ir(e) {
  return {
    descriptor: K.delete_status_update_approval,
    values: { type: e?.type ?? `unknown` },
  };
}
function Lr(e) {
  let t = H(e?.body);
  return {
    descriptor: K.save_comment_approval,
    values: { action: Kr(e), body: t ?? ``, hasBody: t == null ? `no` : `yes` },
  };
}
function Rr(e) {
  let t = H(e?.name);
  return {
    descriptor: K.save_customer_approval,
    values: { action: Gr(e), hasName: t == null ? `no` : `yes`, name: t ?? `` },
  };
}
function zr(e) {
  let t = H(e?.body),
    n = H(e?.customer);
  return {
    descriptor: K.save_customer_need_approval,
    values: {
      action: Gr(e),
      body: t ?? ``,
      customer: n ?? ``,
      hasBody: t == null ? `no` : `yes`,
      hasCustomer: n == null ? `no` : `yes`,
    },
  };
}
function Br(e) {
  let t = H(e?.name),
    n = Jr(e?.targetDate);
  return {
    descriptor: K.save_initiative_approval,
    values: {
      action: Gr(e),
      hasName: t == null ? `no` : `yes`,
      name: t ?? ``,
      targetDate: n.value,
      targetDateChange: n.change,
    },
  };
}
function Vr(e) {
  let t = H(e?.title),
    n = qr(e?.project),
    r = qr(e?.assignee);
  return {
    descriptor: K.save_issue_approval,
    values: {
      action: Gr(e),
      assignee: r.value,
      assigneeChange: r.change,
      hasTitle: t == null ? `no` : `yes`,
      project: n.value,
      projectChange: n.change,
      title: t ?? ``,
    },
  };
}
function Hr(e) {
  let t = H(e?.name),
    n = H(e?.project),
    r = Jr(e?.targetDate);
  return {
    descriptor: K.save_milestone_approval,
    values: {
      action: Gr(e),
      hasName: t == null ? `no` : `yes`,
      hasProject: n == null ? `no` : `yes`,
      name: t ?? ``,
      project: n ?? ``,
      targetDate: r.value,
      targetDateChange: r.change,
    },
  };
}
function Ur(e) {
  let t = H(e?.name),
    n = Jr(e?.targetDate);
  return {
    descriptor: K.save_project_approval,
    values: {
      action: Gr(e),
      hasName: t == null ? `no` : `yes`,
      name: t ?? ``,
      targetDate: n.value,
      targetDateChange: n.change,
    },
  };
}
function Wr(e) {
  let t = H(e?.body),
    n = H(e?.type === `initiative` ? e.initiative : e?.project);
  return {
    descriptor: K.save_status_update_approval,
    values: {
      action: Gr(e),
      body: t ?? ``,
      hasBody: t == null ? `no` : `yes`,
      hasTarget: n == null ? `no` : `yes`,
      target: n ?? ``,
      type: e?.type ?? `unknown`,
    },
  };
}
function Gr(e) {
  return e == null ? `save` : e.id == null ? `create` : `update`;
}
function Kr(e) {
  return e == null
    ? `save`
    : e.id == null
      ? e.parentId == null
        ? `create`
        : `reply`
      : `update`;
}
function qr(e) {
  switch (e) {
    case null:
      return { change: `clear`, value: `` };
    case void 0:
      return { change: `unchanged`, value: `` };
    default: {
      let t = H(e);
      return t == null
        ? { change: `unchanged`, value: `` }
        : { change: `set`, value: t };
    }
  }
}
function Jr(e) {
  switch (e) {
    case null:
      return { change: `clear`, value: 0 };
    case void 0:
      return { change: `unchanged`, value: 0 };
    default: {
      let t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(e) ? `${e}T00:00:00` : e);
      return Number.isFinite(t)
        ? { change: `set`, value: t }
        : { change: `unchanged`, value: 0 };
    }
  }
}
function H(e) {
  let t = D({ maxLength: ri, value: e ?? void 0 });
  return t == null || !ti(t) ? void 0 : t;
}
function Yr() {
  let e = (e, t) => {
    let n = e.toolArguments;
    if (!e.hasInvocationContext || n == null)
      return e.intl.formatMessage(K[`list_issues_${t}`]);
    let r = U(n.query);
    if (r != null)
      return e.intl.formatMessage(K[`list_issues_${t}WithVariant1`], {
        query: r,
      });
    let i = U(n.project);
    if (i != null)
      return e.intl.formatMessage(K[`list_issues_${t}WithVariant2`], {
        target: i,
      });
    let a = U(n.team);
    if (a != null)
      return e.intl.formatMessage(K[`list_issues_${t}WithVariant3`], {
        target: a,
      });
    let o = U(n.assignee) ?? U(n.state);
    return o == null
      ? e.intl.formatMessage(K[`list_issues_${t}`])
      : e.intl.formatMessage(K[`list_issues_${t}WithVariant4`], { target: o });
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function Xr() {
  let e = (e, t) => {
    let n = e.toolArguments;
    if (!e.hasInvocationContext || n == null)
      return e.intl.formatMessage(K[`save_customer_need_${t}`]);
    let r = ei(n.issue);
    if (r != null)
      return e.intl.formatMessage(K[`save_customer_need_${t}WithVariant1`], {
        identifier: r,
      });
    let i = U(n.customer) ?? U(n.project);
    return i == null
      ? e.intl.formatMessage(K[`save_customer_need_${t}`])
      : e.intl.formatMessage(K[`save_customer_need_${t}WithVariant2`], {
          itemName: i,
        });
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function Zr() {
  let e = (e, t) => {
    let n = e.toolArguments;
    if (!e.hasInvocationContext || n == null)
      return e.intl.formatMessage(K[`save_issue_${t}`]);
    let r = U(n.title);
    if (r != null)
      return e.intl.formatMessage(K[`save_issue_${t}WithVariant1`], {
        itemName: r,
      });
    let i = ei(n.id);
    if (i != null)
      return e.intl.formatMessage(K[`save_issue_${t}WithVariant2`], {
        identifier: i,
      });
    let a = U(n.project) ?? U(n.team);
    return a == null
      ? e.intl.formatMessage(K[`save_issue_${t}`])
      : e.intl.formatMessage(K[`save_issue_${t}WithVariant3`], { target: a });
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function Qr() {
  let e = (e, t) => {
    let n = e.toolArguments;
    if (!e.hasInvocationContext || n == null)
      return e.intl.formatMessage(K[`save_milestone_${t}`]);
    let r = U(n.name);
    if (r != null)
      return e.intl.formatMessage(K[`save_milestone_${t}WithVariant1`], {
        itemName: r,
      });
    let i = U(n.project);
    return i == null
      ? e.intl.formatMessage(K[`save_milestone_${t}`])
      : e.intl.formatMessage(K[`save_milestone_${t}WithVariant2`], {
          target: i,
        });
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function $r() {
  let e = (e, t) => {
    let n = e.toolArguments;
    if (!e.hasInvocationContext || n == null)
      return e.intl.formatMessage(K[`search_${t}`]);
    let r = U(n.query);
    if (r == null) return e.intl.formatMessage(K[`search_${t}`]);
    let i = U(n.type);
    return i == null
      ? e.intl.formatMessage(K[`search_${t}WithVariant2`], { query: r })
      : e.intl.formatMessage(K[`search_${t}WithVariant1`], {
          query: r,
          target: i,
        });
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function U(e) {
  let t = D({ maxLength: W, value: e });
  return t == null || !ti(t) ? void 0 : t;
}
function ei(e) {
  return e != null && ti(e) ? e : void 0;
}
function ti(e) {
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    e,
  );
}
var ni, ri, W, ii, G, ai, oi, si, ci, li, K;
function ui() {
  return (ui = e(() => {
    (d(),
      c(),
      O(),
      (ni = `linear`),
      (ri = 80),
      (W = 40),
      (ii = f({
        assignee: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        customer: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        id: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        issue: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        issueId: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        issue_id: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        project: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        state: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        team: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
        title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        type: p()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .catch(void 0),
      }).strip()),
      (G = (e = 1e4) =>
        p()
          .trim()
          .min(1)
          .max(e)
          .optional()
          .catch(void 0)),
      (ai = (e = 1e4) =>
        p()
          .trim()
          .min(1)
          .max(e)
          .nullable()
          .optional()
          .catch(void 0)),
      (oi = f({
        assignee: ai(120),
        body: G(),
        customer: G(120),
        filename: G(500),
        id: G(120),
        initiative: G(200),
        name: G(200),
        parentId: G(120),
        project: ai(200),
        targetDate: ai(200),
        title: G(200),
        type: G(120),
      }).strip()),
      (si = {
        create_attachment: Pr,
        create_issue_label: Fr,
        delete_attachment: () => ({ descriptor: K.delete_attachment_approval }),
        delete_comment: () => ({ descriptor: K.delete_comment_approval }),
        delete_customer: () => ({ descriptor: K.delete_customer_approval }),
        delete_customer_need: () => ({
          descriptor: K.delete_customer_need_approval,
        }),
        delete_status_update: Ir,
        save_comment: Lr,
        save_customer: Rr,
        save_customer_need: zr,
        save_initiative: Br,
        save_issue: Vr,
        save_milestone: Hr,
        save_project: Ur,
        save_status_update: Wr,
      }),
      (ci = {
        create_attachment: w(() => ({
          active: K.create_attachment_active,
          completed: K.create_attachment_completed,
        })),
        create_document: w(() => ({
          active: K.create_document_active,
          completed: K.create_document_completed,
        })),
        create_issue_label: T({
          getItemName: (e) => U(e.name),
          getMessages: () => ({
            withoutContext: {
              active: K.create_issue_label_active,
              completed: K.create_issue_label_completed,
            },
            withContext: {
              active: K.create_issue_label_activeWithName,
              completed: K.create_issue_label_completedWithName,
            },
          }),
          maxPreviewLength: W,
        }),
        delete_attachment: w(() => ({
          active: K.delete_attachment_active,
          completed: K.delete_attachment_completed,
        })),
        delete_comment: w(() => ({
          active: K.delete_comment_active,
          completed: K.delete_comment_completed,
        })),
        delete_customer: w(() => ({
          active: K.delete_customer_active,
          completed: K.delete_customer_completed,
        })),
        delete_customer_need: w(() => ({
          active: K.delete_customer_need_active,
          completed: K.delete_customer_need_completed,
        })),
        delete_status_update: w(() => ({
          active: K.delete_status_update_active,
          completed: K.delete_status_update_completed,
        })),
        extract_images: w(() => ({
          active: K.extract_images_active,
          completed: K.extract_images_completed,
        })),
        fetch: w(() => ({
          active: K.fetch_active,
          completed: K.fetch_completed,
        })),
        get_attachment: w(() => ({
          active: K.get_attachment_active,
          completed: K.get_attachment_completed,
        })),
        get_document: E({
          getMessages: () => ({
            withoutContext: {
              active: K.get_document_active,
              completed: K.get_document_completed,
            },
            withContext: {
              active: K.get_document_activeWithIdentifier,
              completed: K.get_document_completedWithIdentifier,
            },
          }),
          getValue: (e) => ei(e.id),
          maxPreviewLength: W,
          valueName: `identifier`,
        }),
        get_initiative: T({
          getItemName: (e) => U(e.query),
          getMessages: () => ({
            withoutContext: {
              active: K.get_initiative_active,
              completed: K.get_initiative_completed,
            },
            withContext: {
              active: K.get_initiative_activeWithName,
              completed: K.get_initiative_completedWithName,
            },
          }),
          maxPreviewLength: W,
        }),
        get_issue: E({
          getValue: (e) => ei(e.issueId ?? e.issue_id ?? e.id),
          getMessages: () => ({
            withoutContext: {
              active: K.get_issue_active,
              completed: K.get_issue_completed,
            },
            withContext: {
              active: K.get_issue_activeWithVariant1,
              completed: K.get_issue_completedWithVariant1,
            },
          }),
          maxPreviewLength: 120,
          valueName: `identifier`,
        }),
        get_issue_status: w(() => ({
          active: K.get_issue_status_active,
          completed: K.get_issue_status_completed,
        })),
        get_milestone: T({
          getItemName: (e) => U(e.query),
          getMessages: () => ({
            withoutContext: {
              active: K.get_milestone_active,
              completed: K.get_milestone_completed,
            },
            withContext: {
              active: K.get_milestone_activeWithName,
              completed: K.get_milestone_completedWithName,
            },
          }),
          maxPreviewLength: W,
        }),
        get_project: T({
          getItemName: (e) => U(e.query),
          getMessages: () => ({
            withoutContext: {
              active: K.get_project_active,
              completed: K.get_project_completed,
            },
            withContext: {
              active: K.get_project_activeWithVariant1,
              completed: K.get_project_completedWithVariant1,
            },
          }),
          maxPreviewLength: W,
        }),
        get_status_updates: w(() => ({
          active: K.get_status_updates_active,
          completed: K.get_status_updates_completed,
        })),
        get_team: T({
          getItemName: (e) => U(e.query),
          getMessages: () => ({
            withoutContext: {
              active: K.get_team_active,
              completed: K.get_team_completed,
            },
            withContext: {
              active: K.get_team_activeWithName,
              completed: K.get_team_completedWithName,
            },
          }),
          maxPreviewLength: W,
        }),
        get_user: T({
          getItemName: (e) => U(e.query),
          getMessages: () => ({
            withoutContext: {
              active: K.get_user_active,
              completed: K.get_user_completed,
            },
            withContext: {
              active: K.get_user_activeWithName,
              completed: K.get_user_completedWithName,
            },
          }),
          maxPreviewLength: W,
        }),
        list_comments: w(() => ({
          active: K.list_comments_active,
          completed: K.list_comments_completed,
        })),
        list_customers: w(() => ({
          active: K.list_customers_active,
          completed: K.list_customers_completed,
        })),
        list_cycles: w(() => ({
          active: K.list_cycles_active,
          completed: K.list_cycles_completed,
        })),
        list_documents: w(() => ({
          active: K.list_documents_active,
          completed: K.list_documents_completed,
        })),
        list_initiatives: w(() => ({
          active: K.list_initiatives_active,
          completed: K.list_initiatives_completed,
        })),
        list_issue_labels: w(() => ({
          active: K.list_issue_labels_active,
          completed: K.list_issue_labels_completed,
        })),
        list_issue_statuses: w(() => ({
          active: K.list_issue_statuses_active,
          completed: K.list_issue_statuses_completed,
        })),
        list_issues: Yr(),
        list_milestones: E({
          getValue: (e) => U(e.project),
          getMessages: () => ({
            withoutContext: {
              active: K.list_milestones_active,
              completed: K.list_milestones_completed,
            },
            withContext: {
              active: K.list_milestones_activeWithVariant1,
              completed: K.list_milestones_completedWithVariant1,
            },
          }),
          maxPreviewLength: W,
          valueName: `target`,
        }),
        list_project_labels: w(() => ({
          active: K.list_project_labels_active,
          completed: K.list_project_labels_completed,
        })),
        list_projects: w(() => ({
          active: K.list_projects_active,
          completed: K.list_projects_completed,
        })),
        list_teams: w(() => ({
          active: K.list_teams_active,
          completed: K.list_teams_completed,
        })),
        list_users: w(() => ({
          active: K.list_users_active,
          completed: K.list_users_completed,
        })),
        research: E({
          getValue: (e) => U(e.query),
          getMessages: () => ({
            withoutContext: {
              active: K.research_active,
              completed: K.research_completed,
            },
            withContext: {
              active: K.research_activeWithVariant1,
              completed: K.research_completedWithVariant1,
            },
          }),
          maxPreviewLength: W,
          valueName: `query`,
        }),
        save_comment: E({
          getValue: (e) => ei(e.issueId),
          getMessages: () => ({
            withoutContext: {
              active: K.save_comment_active,
              completed: K.save_comment_completed,
            },
            withContext: {
              active: K.save_comment_activeWithVariant1,
              completed: K.save_comment_completedWithVariant1,
            },
          }),
          maxPreviewLength: 120,
          valueName: `identifier`,
        }),
        save_customer: T({
          getItemName: (e) => U(e.name),
          getMessages: () => ({
            withoutContext: {
              active: K.save_customer_active,
              completed: K.save_customer_completed,
            },
            withContext: {
              active: K.save_customer_activeWithVariant1,
              completed: K.save_customer_completedWithVariant1,
            },
          }),
          maxPreviewLength: W,
        }),
        save_customer_need: Xr(),
        save_initiative: T({
          getItemName: (e) => U(e.name),
          getMessages: () => ({
            withoutContext: {
              active: K.save_initiative_active,
              completed: K.save_initiative_completed,
            },
            withContext: {
              active: K.save_initiative_activeWithVariant1,
              completed: K.save_initiative_completedWithVariant1,
            },
          }),
          maxPreviewLength: W,
        }),
        save_issue: Zr(),
        save_milestone: Qr(),
        save_project: T({
          getItemName: (e) => U(e.name),
          getMessages: () => ({
            withoutContext: {
              active: K.save_project_active,
              completed: K.save_project_completed,
            },
            withContext: {
              active: K.save_project_activeWithVariant1,
              completed: K.save_project_completedWithVariant1,
            },
          }),
          maxPreviewLength: W,
        }),
        save_status_update: w(() => ({
          active: K.save_status_update_active,
          completed: K.save_status_update_completed,
        })),
        search: $r(),
        search_documentation: E({
          getValue: (e) => U(e.query),
          getMessages: () => ({
            withoutContext: {
              active: K.search_documentation_active,
              completed: K.search_documentation_completed,
            },
            withContext: {
              active: K.search_documentation_activeWithVariant1,
              completed: K.search_documentation_completedWithVariant1,
            },
          }),
          maxPreviewLength: W,
          valueName: `query`,
        }),
        update_document: w(() => ({
          active: K.update_document_active,
          completed: K.update_document_completed,
        })),
      }),
      (li = C({ appRegistryKey: ni, toolArgumentsSchema: ii, tools: ci })),
      (K = h({
        create_attachment_active: {
          id: `localConversation.mcpToolActivity.linear.create_attachment.active`,
        },
        create_attachment_completed: {
          id: `localConversation.mcpToolActivity.linear.create_attachment.completed`,
        },
        create_document_active: {
          id: `localConversation.mcpToolActivity.linear.create_document.active`,
        },
        create_document_completed: {
          id: `localConversation.mcpToolActivity.linear.create_document.completed`,
        },
        create_issue_label_active: {
          id: `localConversation.mcpToolActivity.linear.create_issue_label.active`,
        },
        create_issue_label_activeWithName: {
          id: `localConversation.mcpToolActivity.linear.create_issue_label.activeWithName`,
        },
        create_issue_label_completed: {
          id: `localConversation.mcpToolActivity.linear.create_issue_label.completed`,
        },
        create_issue_label_completedWithName: {
          id: `localConversation.mcpToolActivity.linear.create_issue_label.completedWithName`,
        },
        delete_attachment_active: {
          id: `localConversation.mcpToolActivity.linear.delete_attachment.active`,
        },
        delete_attachment_completed: {
          id: `localConversation.mcpToolActivity.linear.delete_attachment.completed`,
        },
        delete_comment_active: {
          id: `localConversation.mcpToolActivity.linear.delete_comment.active`,
        },
        delete_comment_completed: {
          id: `localConversation.mcpToolActivity.linear.delete_comment.completed`,
        },
        delete_customer_active: {
          id: `localConversation.mcpToolActivity.linear.delete_customer.active`,
        },
        delete_customer_completed: {
          id: `localConversation.mcpToolActivity.linear.delete_customer.completed`,
        },
        delete_customer_need_active: {
          id: `localConversation.mcpToolActivity.linear.delete_customer_need.active`,
        },
        delete_customer_need_completed: {
          id: `localConversation.mcpToolActivity.linear.delete_customer_need.completed`,
        },
        delete_status_update_active: {
          id: `localConversation.mcpToolActivity.linear.delete_status_update.active`,
        },
        delete_status_update_completed: {
          id: `localConversation.mcpToolActivity.linear.delete_status_update.completed`,
        },
        extract_images_active: {
          id: `localConversation.mcpToolActivity.linear.extract_images.active`,
        },
        extract_images_completed: {
          id: `localConversation.mcpToolActivity.linear.extract_images.completed`,
        },
        fetch_active: {
          id: `localConversation.mcpToolActivity.linear.fetch.active`,
        },
        fetch_completed: {
          id: `localConversation.mcpToolActivity.linear.fetch.completed`,
        },
        get_attachment_active: {
          id: `localConversation.mcpToolActivity.linear.get_attachment.active`,
        },
        get_attachment_completed: {
          id: `localConversation.mcpToolActivity.linear.get_attachment.completed`,
        },
        get_document_active: {
          id: `localConversation.mcpToolActivity.linear.get_document.active`,
        },
        get_document_activeWithIdentifier: {
          id: `localConversation.mcpToolActivity.linear.get_document.activeWithIdentifier`,
        },
        get_document_completed: {
          id: `localConversation.mcpToolActivity.linear.get_document.completed`,
        },
        get_document_completedWithIdentifier: {
          id: `localConversation.mcpToolActivity.linear.get_document.completedWithIdentifier`,
        },
        get_initiative_active: {
          id: `localConversation.mcpToolActivity.linear.get_initiative.active`,
        },
        get_initiative_activeWithName: {
          id: `localConversation.mcpToolActivity.linear.get_initiative.activeWithName`,
        },
        get_initiative_completed: {
          id: `localConversation.mcpToolActivity.linear.get_initiative.completed`,
        },
        get_initiative_completedWithName: {
          id: `localConversation.mcpToolActivity.linear.get_initiative.completedWithName`,
        },
        get_issue_active: {
          id: `localConversation.mcpToolActivity.linear.get_issue.active`,
        },
        get_issue_completed: {
          id: `localConversation.mcpToolActivity.linear.get_issue.completed`,
        },
        get_issue_status_active: {
          id: `localConversation.mcpToolActivity.linear.get_issue_status.active`,
        },
        get_issue_status_completed: {
          id: `localConversation.mcpToolActivity.linear.get_issue_status.completed`,
        },
        get_milestone_active: {
          id: `localConversation.mcpToolActivity.linear.get_milestone.active`,
        },
        get_milestone_activeWithName: {
          id: `localConversation.mcpToolActivity.linear.get_milestone.activeWithName`,
        },
        get_milestone_completed: {
          id: `localConversation.mcpToolActivity.linear.get_milestone.completed`,
        },
        get_milestone_completedWithName: {
          id: `localConversation.mcpToolActivity.linear.get_milestone.completedWithName`,
        },
        get_project_active: {
          id: `localConversation.mcpToolActivity.linear.get_project.active`,
        },
        get_project_completed: {
          id: `localConversation.mcpToolActivity.linear.get_project.completed`,
        },
        get_status_updates_active: {
          id: `localConversation.mcpToolActivity.linear.get_status_updates.active`,
        },
        get_status_updates_completed: {
          id: `localConversation.mcpToolActivity.linear.get_status_updates.completed`,
        },
        get_team_active: {
          id: `localConversation.mcpToolActivity.linear.get_team.active`,
        },
        get_team_activeWithName: {
          id: `localConversation.mcpToolActivity.linear.get_team.activeWithName`,
        },
        get_team_completed: {
          id: `localConversation.mcpToolActivity.linear.get_team.completed`,
        },
        get_team_completedWithName: {
          id: `localConversation.mcpToolActivity.linear.get_team.completedWithName`,
        },
        get_user_active: {
          id: `localConversation.mcpToolActivity.linear.get_user.active`,
        },
        get_user_activeWithName: {
          id: `localConversation.mcpToolActivity.linear.get_user.activeWithName`,
        },
        get_user_completed: {
          id: `localConversation.mcpToolActivity.linear.get_user.completed`,
        },
        get_user_completedWithName: {
          id: `localConversation.mcpToolActivity.linear.get_user.completedWithName`,
        },
        list_comments_active: {
          id: `localConversation.mcpToolActivity.linear.list_comments.active`,
        },
        list_comments_completed: {
          id: `localConversation.mcpToolActivity.linear.list_comments.completed`,
        },
        list_customers_active: {
          id: `localConversation.mcpToolActivity.linear.list_customers.active`,
        },
        list_customers_completed: {
          id: `localConversation.mcpToolActivity.linear.list_customers.completed`,
        },
        list_cycles_active: {
          id: `localConversation.mcpToolActivity.linear.list_cycles.active`,
        },
        list_cycles_completed: {
          id: `localConversation.mcpToolActivity.linear.list_cycles.completed`,
        },
        list_documents_active: {
          id: `localConversation.mcpToolActivity.linear.list_documents.active`,
        },
        list_documents_completed: {
          id: `localConversation.mcpToolActivity.linear.list_documents.completed`,
        },
        list_initiatives_active: {
          id: `localConversation.mcpToolActivity.linear.list_initiatives.active`,
        },
        list_initiatives_completed: {
          id: `localConversation.mcpToolActivity.linear.list_initiatives.completed`,
        },
        list_issue_labels_active: {
          id: `localConversation.mcpToolActivity.linear.list_issue_labels.active`,
        },
        list_issue_labels_completed: {
          id: `localConversation.mcpToolActivity.linear.list_issue_labels.completed`,
        },
        list_issue_statuses_active: {
          id: `localConversation.mcpToolActivity.linear.list_issue_statuses.active`,
        },
        list_issue_statuses_completed: {
          id: `localConversation.mcpToolActivity.linear.list_issue_statuses.completed`,
        },
        list_issues_active: {
          id: `localConversation.mcpToolActivity.linear.list_issues.active`,
        },
        list_issues_completed: {
          id: `localConversation.mcpToolActivity.linear.list_issues.completed`,
        },
        list_milestones_active: {
          id: `localConversation.mcpToolActivity.linear.list_milestones.active`,
        },
        list_milestones_completed: {
          id: `localConversation.mcpToolActivity.linear.list_milestones.completed`,
        },
        list_project_labels_active: {
          id: `localConversation.mcpToolActivity.linear.list_project_labels.active`,
        },
        list_project_labels_completed: {
          id: `localConversation.mcpToolActivity.linear.list_project_labels.completed`,
        },
        list_projects_active: {
          id: `localConversation.mcpToolActivity.linear.list_projects.active`,
        },
        list_projects_completed: {
          id: `localConversation.mcpToolActivity.linear.list_projects.completed`,
        },
        list_teams_active: {
          id: `localConversation.mcpToolActivity.linear.list_teams.active`,
        },
        list_teams_completed: {
          id: `localConversation.mcpToolActivity.linear.list_teams.completed`,
        },
        list_users_active: {
          id: `localConversation.mcpToolActivity.linear.list_users.active`,
        },
        list_users_completed: {
          id: `localConversation.mcpToolActivity.linear.list_users.completed`,
        },
        research_active: {
          id: `localConversation.mcpToolActivity.linear.research.active`,
        },
        research_completed: {
          id: `localConversation.mcpToolActivity.linear.research.completed`,
        },
        save_comment_active: {
          id: `localConversation.mcpToolActivity.linear.save_comment.active`,
        },
        save_comment_completed: {
          id: `localConversation.mcpToolActivity.linear.save_comment.completed`,
        },
        save_customer_active: {
          id: `localConversation.mcpToolActivity.linear.save_customer.active`,
        },
        save_customer_completed: {
          id: `localConversation.mcpToolActivity.linear.save_customer.completed`,
        },
        save_customer_need_active: {
          id: `localConversation.mcpToolActivity.linear.save_customer_need.active`,
        },
        save_customer_need_completed: {
          id: `localConversation.mcpToolActivity.linear.save_customer_need.completed`,
        },
        save_initiative_active: {
          id: `localConversation.mcpToolActivity.linear.save_initiative.active`,
        },
        save_initiative_completed: {
          id: `localConversation.mcpToolActivity.linear.save_initiative.completed`,
        },
        save_issue_active: {
          id: `localConversation.mcpToolActivity.linear.save_issue.active`,
        },
        save_issue_completed: {
          id: `localConversation.mcpToolActivity.linear.save_issue.completed`,
        },
        save_milestone_active: {
          id: `localConversation.mcpToolActivity.linear.save_milestone.active`,
        },
        save_milestone_completed: {
          id: `localConversation.mcpToolActivity.linear.save_milestone.completed`,
        },
        save_project_active: {
          id: `localConversation.mcpToolActivity.linear.save_project.active`,
        },
        save_project_completed: {
          id: `localConversation.mcpToolActivity.linear.save_project.completed`,
        },
        save_status_update_active: {
          id: `localConversation.mcpToolActivity.linear.save_status_update.active`,
        },
        save_status_update_completed: {
          id: `localConversation.mcpToolActivity.linear.save_status_update.completed`,
        },
        search_active: {
          id: `localConversation.mcpToolActivity.linear.search.active`,
        },
        search_completed: {
          id: `localConversation.mcpToolActivity.linear.search.completed`,
        },
        search_documentation_active: {
          id: `localConversation.mcpToolActivity.linear.search_documentation.active`,
        },
        search_documentation_completed: {
          id: `localConversation.mcpToolActivity.linear.search_documentation.completed`,
        },
        update_document_active: {
          id: `localConversation.mcpToolActivity.linear.update_document.active`,
        },
        update_document_completed: {
          id: `localConversation.mcpToolActivity.linear.update_document.completed`,
        },
        get_issue_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.get_issue.activeWithVariant1`,
        },
        get_issue_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.get_issue.completedWithVariant1`,
        },
        get_project_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.get_project.activeWithVariant1`,
        },
        get_project_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.get_project.completedWithVariant1`,
        },
        list_issues_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.list_issues.activeWithVariant1`,
        },
        list_issues_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.list_issues.completedWithVariant1`,
        },
        list_issues_activeWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.list_issues.activeWithVariant2`,
        },
        list_issues_completedWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.list_issues.completedWithVariant2`,
        },
        list_issues_activeWithVariant3: {
          id: `localConversation.mcpToolActivity.linear.list_issues.activeWithVariant3`,
        },
        list_issues_completedWithVariant3: {
          id: `localConversation.mcpToolActivity.linear.list_issues.completedWithVariant3`,
        },
        list_issues_activeWithVariant4: {
          id: `localConversation.mcpToolActivity.linear.list_issues.activeWithVariant4`,
        },
        list_issues_completedWithVariant4: {
          id: `localConversation.mcpToolActivity.linear.list_issues.completedWithVariant4`,
        },
        list_milestones_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.list_milestones.activeWithVariant1`,
        },
        list_milestones_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.list_milestones.completedWithVariant1`,
        },
        research_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.research.activeWithVariant1`,
        },
        research_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.research.completedWithVariant1`,
        },
        save_comment_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_comment.activeWithVariant1`,
        },
        save_comment_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_comment.completedWithVariant1`,
        },
        save_customer_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_customer.activeWithVariant1`,
        },
        save_customer_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_customer.completedWithVariant1`,
        },
        save_customer_need_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_customer_need.activeWithVariant1`,
        },
        save_customer_need_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_customer_need.completedWithVariant1`,
        },
        save_customer_need_activeWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.save_customer_need.activeWithVariant2`,
        },
        save_customer_need_completedWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.save_customer_need.completedWithVariant2`,
        },
        save_initiative_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_initiative.activeWithVariant1`,
        },
        save_initiative_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_initiative.completedWithVariant1`,
        },
        save_issue_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_issue.activeWithVariant1`,
        },
        save_issue_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_issue.completedWithVariant1`,
        },
        save_issue_activeWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.save_issue.activeWithVariant2`,
        },
        save_issue_completedWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.save_issue.completedWithVariant2`,
        },
        save_issue_activeWithVariant3: {
          id: `localConversation.mcpToolActivity.linear.save_issue.activeWithVariant3`,
        },
        save_issue_completedWithVariant3: {
          id: `localConversation.mcpToolActivity.linear.save_issue.completedWithVariant3`,
        },
        save_milestone_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_milestone.activeWithVariant1`,
        },
        save_milestone_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_milestone.completedWithVariant1`,
        },
        save_milestone_activeWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.save_milestone.activeWithVariant2`,
        },
        save_milestone_completedWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.save_milestone.completedWithVariant2`,
        },
        save_project_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_project.activeWithVariant1`,
        },
        save_project_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.save_project.completedWithVariant1`,
        },
        search_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.search.activeWithVariant1`,
        },
        search_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.search.completedWithVariant1`,
        },
        search_activeWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.search.activeWithVariant2`,
        },
        search_completedWithVariant2: {
          id: `localConversation.mcpToolActivity.linear.search.completedWithVariant2`,
        },
        search_documentation_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.search_documentation.activeWithVariant1`,
        },
        search_documentation_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.linear.search_documentation.completedWithVariant1`,
        },
        create_attachment_approval: {
          id: `localConversation.mcpToolApproval.linear.create_attachment.v2`,
        },
        create_issue_label_approval: {
          id: `localConversation.mcpToolApproval.linear.create_issue_label.v2`,
        },
        delete_attachment_approval: {
          id: `localConversation.mcpToolApproval.linear.delete_attachment`,
        },
        delete_comment_approval: {
          id: `localConversation.mcpToolApproval.linear.delete_comment`,
        },
        delete_customer_approval: {
          id: `localConversation.mcpToolApproval.linear.delete_customer`,
        },
        delete_customer_need_approval: {
          id: `localConversation.mcpToolApproval.linear.delete_customer_need`,
        },
        delete_status_update_approval: {
          id: `localConversation.mcpToolApproval.linear.delete_status_update`,
        },
        save_comment_approval: {
          id: `localConversation.mcpToolApproval.linear.save_comment`,
        },
        save_customer_approval: {
          id: `localConversation.mcpToolApproval.linear.save_customer.v2`,
        },
        save_customer_need_approval: {
          id: `localConversation.mcpToolApproval.linear.save_customer_need.v2`,
        },
        save_initiative_approval: {
          id: `localConversation.mcpToolApproval.linear.save_initiative.v2`,
        },
        save_issue_approval: {
          id: `localConversation.mcpToolApproval.linear.save_issue.v2`,
        },
        save_milestone_approval: {
          id: `localConversation.mcpToolApproval.linear.save_milestone.v2`,
        },
        save_project_approval: {
          id: `localConversation.mcpToolApproval.linear.save_project.v2`,
        },
        save_status_update_approval: {
          id: `localConversation.mcpToolApproval.linear.save_status_update.v2`,
        },
      })));
  }))();
}
function di(e) {
  let t = q(e?.title),
    n = q(e?.description),
    r = q(e?.statements),
    i = `none`;
  e?.in_trash != null && (i = e.in_trash ? `move` : `restore`);
  let a = `none`;
  return (
    e?.is_inline != null && (a = e.is_inline ? `inline` : `full_page`),
    t == null && n == null && r == null && i === `none` && a === `none`
      ? { descriptor: Y.update_data_source_approval }
      : {
          descriptor: Y.update_data_source_approvalWithContext,
          values: {
            description: n ?? ``,
            hasDescription: n == null ? `no` : `yes`,
            hasStatements: r == null ? `no` : `yes`,
            hasTitle: t == null ? `no` : `yes`,
            inlineAction: a,
            statements: r ?? ``,
            title: t ?? ``,
            trashAction: i,
          },
        }
  );
}
function fi(e) {
  let t = q(pi(e)),
    n = q(e?.new_str),
    r = q(e?.cover),
    i = q(e?.icon),
    a = `none`;
  r != null && (a = r.toLowerCase() === `none` ? `remove` : `set`);
  let o = `none`;
  i != null && (o = i.toLowerCase() === `none` ? `remove` : `set`);
  let s = `none`;
  return (
    e?.allow_deleting_content != null &&
      (s = e.allow_deleting_content ? `allow` : `deny`),
    e?.command == null &&
    t == null &&
    n == null &&
    a === `none` &&
    o === `none` &&
    e?.verification_status == null &&
    s === `none`
      ? { descriptor: Y.update_page_approval }
      : {
          descriptor: Y.update_page_approvalWithContext,
          values: {
            command: e?.command ?? `unknown`,
            contentDeletionPermission: s,
            cover: r ?? ``,
            coverAction: a,
            hasNewContent: n == null ? `no` : `yes`,
            hasNewTitle: t == null ? `no` : `yes`,
            hasVerificationExpiryDays:
              e?.verification_status === `verified` &&
              e.verification_expiry_days != null
                ? `yes`
                : `no`,
            icon: i ?? ``,
            iconAction: o,
            newContent: n ?? ``,
            newTitle: t ?? ``,
            verificationExpiryDays: e?.verification_expiry_days ?? 0,
            verificationStatus: e?.verification_status ?? `unknown`,
          },
        }
  );
}
function pi(e) {
  if (e?.title != null) return e.title;
  for (let t of Object.values(e?.properties ?? {})) {
    if (typeof t != `object` || !t || Array.isArray(t) || t.title == null)
      continue;
    let e = t.title
      .map((e) => e.plain_text ?? e.text?.content ?? ``)
      .join(``)
      .trim();
    if (e.length > 0) return e;
  }
}
function mi() {
  let e = (e, t) => {
    if (!e.hasInvocationContext || e.toolArguments == null)
      return e.intl.formatMessage(Y[`create_pages_${t}`]);
    let n = q(vi(e.toolArguments.pages));
    if (n != null)
      return e.intl.formatMessage(Y[`create_pages_${t}WithVariant1`], {
        itemName: n,
      });
    let r = e.toolArguments.pages?.length;
    return r == null || r === 0
      ? e.intl.formatMessage(Y[`create_pages_${t}`])
      : e.intl.formatMessage(Y[`create_pages_${t}WithVariant2`], {
          itemCount: r,
        });
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function q(e) {
  if (!(e == null || bi(e.trim())))
    return D({ maxLength: J, value: e }) ?? void 0;
}
function hi(e) {
  if (!(e == null || bi(e))) {
    if (!/^https?:\/\//i.test(e)) return e;
    try {
      let t = new URL(e),
        n = decodeURIComponent(
          t.pathname
            .split(`/`)
            .filter((e) => e.length > 0)
            .pop() ?? ``,
        )
          .replace(/[-_][0-9a-f]{8,}$/i, ``)
          .replace(/[-_]+/g, ` `)
          .trim();
      return n.length > 0 ? n : void 0;
    } catch {
      return;
    }
  }
}
function gi(e) {
  let t = _i(Ht(e));
  if (t != null) return t;
  let n = Oi.safeParse(e);
  if (n.success)
    for (let { text: e } of [
      ...(n.data.content ?? []),
      ...(n.data.raw?.content ?? []),
    ])
      try {
        let t = _i(JSON.parse(e));
        if (t != null) return t;
      } catch {
        continue;
      }
}
function _i(e) {
  let t = Ei.safeParse(e);
  if (!t.success) return;
  let { display_title: n, name: r, result: i, title: a } = t.data,
    o = a ?? n ?? r ?? yi(t.data);
  if (typeof o == `string`) return o;
  let s = Ei.safeParse(i);
  if (!s.success) return;
  let c = s.data.title ?? s.data.display_title ?? s.data.name ?? yi(s.data);
  return typeof c == `string` ? c : void 0;
}
function vi(e) {
  if (e != null)
    for (let t of e) {
      let e = yi(t);
      if (e != null) return e;
    }
}
function yi(e) {
  let t = Ti.safeParse(e);
  if (!t.success) return;
  let { name: n, properties: r, title: i } = t.data;
  for (let e of [i, n]) if (e != null && e.trim().length > 0) return e;
  if (r != null)
    for (let e of [`Name`, `Title`, `name`, `title`]) {
      let t = r[e];
      if (typeof t == `string` && t.trim().length > 0) return t;
      if (typeof t != `object` || !t || Array.isArray(t)) continue;
      let n = (t.title ?? t.rich_text)
        ?.map((e) => e.plain_text ?? e.text?.content ?? ``)
        .join(``)
        .trim();
      if (n != null && n.length > 0) return n;
    }
}
function bi(e) {
  return (
    /^collection:\/\/[0-9a-f-]+$/i.test(e) ||
    /^[0-9a-f]{32}$/i.test(e) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      e,
    )
  );
}
var xi, J, Si, Ci, wi, Ti, Ei, Di, Oi, ki, Ai, ji, Mi, Y;
function Ni() {
  return (Ni = e(() => {
    (d(),
      c(),
      Kt(),
      O(),
      (xi = `notion`),
      (J = 40),
      (Si = p()
        .optional()
        .catch(void 0)),
      (Ci = f({
        plain_text: p()
          .optional()
          .catch(void 0),
        text: f({ content: p() })
          .strip()
          .optional()
          .catch(void 0),
      }).strip()),
      (wi = f({
        rich_text: r(Ci)
          .optional()
          .catch(void 0),
        title: r(Ci)
          .optional()
          .catch(void 0),
      }).strip()),
      (Ti = f({
        name: p()
          .optional()
          .catch(void 0),
        properties: ie(p(), te([p(), _(), r(p()), wi, i()]))
          .optional()
          .catch(void 0),
        title: p()
          .optional()
          .catch(void 0),
      }).strip()),
      (Ei = f({
        display_title: p()
          .optional()
          .catch(void 0),
        name: p()
          .optional()
          .catch(void 0),
        properties: Ti.shape.properties,
        result: m().optional(),
        title: p()
          .optional()
          .catch(void 0),
      }).strip()),
      (Di = f({ text: p(), type: ne(`text`) }).strip()),
      (Oi = f({
        content: r(Di)
          .optional()
          .catch(void 0),
        raw: f({
          content: r(Di)
            .optional()
            .catch(void 0),
        })
          .strip()
          .optional()
          .catch(void 0),
        type: ne(`success`),
      }).strip()),
      (ki = f({
        allow_deleting_content: g()
          .optional()
          .catch(void 0),
        command: t([
          `update_properties`,
          `update_content`,
          `replace_content`,
          `apply_template`,
          `update_verification`,
        ])
          .optional()
          .catch(void 0),
        cover: Si,
        data: f({
          query: p()
            .trim()
            .min(1)
            .max(500)
            .optional()
            .catch(void 0),
        })
          .strip()
          .optional()
          .catch(void 0),
        description: Si,
        icon: Si,
        id: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        in_trash: g()
          .optional()
          .catch(void 0),
        is_inline: g()
          .optional()
          .catch(void 0),
        name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        new_str: Si,
        pages: s(Array.isArray)
          .optional()
          .catch(void 0),
        properties: Ti.shape.properties,
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        statements: Si,
        title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        verification_expiry_days: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        verification_status: t([`verified`, `unverified`])
          .optional()
          .catch(void 0),
      }).strip()),
      (Ai = {
        create_attachment: w(() => ({
          active: Y.create_attachment_active,
          completed: Y.create_attachment_completed,
        })),
        create_comment: w(() => ({
          active: Y.create_comment_active,
          completed: Y.create_comment_completed,
        })),
        create_database: T({
          getItemName: (e) => q(e.title),
          getMessages: () => ({
            withoutContext: {
              active: Y.create_database_active,
              completed: Y.create_database_completed,
            },
            withContext: {
              active: Y.create_database_activeWithVariant1,
              completed: Y.create_database_completedWithVariant1,
            },
          }),
          maxPreviewLength: J,
        }),
        create_pages: mi(),
        create_view: T({
          getItemName: (e) => q(e.name),
          getMessages: () => ({
            withoutContext: {
              active: Y.create_view_active,
              completed: Y.create_view_completed,
            },
            withContext: {
              active: Y.create_view_activeWithVariant1,
              completed: Y.create_view_completedWithVariant1,
            },
          }),
          maxPreviewLength: J,
        }),
        download_attachment: w(() => ({
          active: Y.download_attachment_active,
          completed: Y.download_attachment_completed,
        })),
        duplicate_page: w(() => ({
          active: Y.duplicate_page_active,
          completed: Y.duplicate_page_completed,
        })),
        fetch: Jt({
          getMessages: () => ({
            withoutContext: {
              active: Y.fetch_active,
              completed: Y.fetch_completed,
            },
            withContext: {
              active: Y.fetch_activeWithVariant1,
              completed: Y.fetch_completedWithVariant1,
            },
          }),
          getValues: ({
            hasInvocationContext: e,
            toolArguments: t,
            toolResult: n,
          }) => {
            if (!e || t == null) return null;
            let r = q(gi(n) ?? hi(t.id));
            return r == null ? null : { itemName: r };
          },
        }),
        get_comments: w(() => ({
          active: Y.get_comments_active,
          completed: Y.get_comments_completed,
        })),
        get_teams: w(() => ({
          active: Y.get_teams_active,
          completed: Y.get_teams_completed,
        })),
        get_users: E({
          getMessages: () => ({
            withoutContext: {
              active: Y.get_users_active,
              completed: Y.get_users_completed,
            },
            withContext: {
              active: Y.get_users_activeWithQuery,
              completed: Y.get_users_completedWithQuery,
            },
          }),
          getValue: (e) => e.query,
          maxPreviewLength: J,
          valueName: `query`,
        }),
        move_pages: w(() => ({
          active: Y.move_pages_active,
          completed: Y.move_pages_completed,
        })),
        query_data_sources: E({
          getValue: (e) => q(e.data?.query),
          getMessages: () => ({
            withoutContext: {
              active: Y.query_data_sources_active,
              completed: Y.query_data_sources_completed,
            },
            withContext: {
              active: Y.query_data_sources_activeWithVariant1,
              completed: Y.query_data_sources_completedWithVariant1,
            },
          }),
          maxPreviewLength: J,
          valueName: `query`,
        }),
        query_database_view: w(() => ({
          active: Y.query_database_view_active,
          completed: Y.query_database_view_completed,
        })),
        query_meeting_notes: E({
          getValue: (e) => q(e.query),
          getMessages: () => ({
            withoutContext: {
              active: Y.query_meeting_notes_active,
              completed: Y.query_meeting_notes_completed,
            },
            withContext: {
              active: Y.query_meeting_notes_activeWithQuery,
              completed: Y.query_meeting_notes_completedWithQuery,
            },
          }),
          maxPreviewLength: J,
          valueName: `query`,
        }),
        search: E({
          getValue: (e) => q(e.query),
          getMessages: () => ({
            withoutContext: {
              active: Y.search_active,
              completed: Y.search_completed,
            },
            withContext: {
              active: Y.search_activeWithVariant1,
              completed: Y.search_completedWithVariant1,
            },
          }),
          maxPreviewLength: J,
          valueName: `query`,
        }),
        update_data_source: T({
          getItemName: (e) => q(e.title),
          getMessages: () => ({
            withoutContext: {
              active: Y.update_data_source_active,
              completed: Y.update_data_source_completed,
            },
            withContext: {
              active: Y.update_data_source_activeWithTitle,
              completed: Y.update_data_source_completedWithTitle,
            },
          }),
          maxPreviewLength: J,
          approval: di,
        }),
        update_page: T({
          getItemName: (e) => q(yi(e)),
          getMessages: () => ({
            withoutContext: {
              active: Y.update_page_active,
              completed: Y.update_page_completed,
            },
            withContext: {
              active: Y.update_page_activeWithTitle,
              completed: Y.update_page_completedWithTitle,
            },
          }),
          maxPreviewLength: J,
          approval: fi,
        }),
        update_view: T({
          getItemName: (e) => q(e.name),
          getMessages: () => ({
            withoutContext: {
              active: Y.update_view_active,
              completed: Y.update_view_completed,
            },
            withContext: {
              active: Y.update_view_activeWithVariant1,
              completed: Y.update_view_completedWithVariant1,
            },
          }),
          maxPreviewLength: J,
        }),
      }),
      (ji = C({ appRegistryKey: xi, toolArgumentsSchema: ki, tools: Ai })),
      (Mi = qt({ toolArgumentsSchema: ki, tools: Ai })),
      (Y = h({
        update_data_source_approval: {
          id: `localConversation.mcpToolApproval.notion.update_data_source.fallback`,
        },
        update_data_source_approvalWithContext: {
          id: `localConversation.mcpToolApproval.notion.update_data_source.context_v2`,
        },
        update_page_approval: {
          id: `localConversation.mcpToolApproval.notion.update_page.fallback`,
        },
        update_page_approvalWithContext: {
          id: `localConversation.mcpToolApproval.notion.update_page.context`,
        },
        create_attachment_active: {
          id: `localConversation.mcpToolActivity.notion.create_attachment.active`,
        },
        create_attachment_completed: {
          id: `localConversation.mcpToolActivity.notion.create_attachment.completed`,
        },
        create_comment_active: {
          id: `localConversation.mcpToolActivity.notion.create_comment.active`,
        },
        create_comment_completed: {
          id: `localConversation.mcpToolActivity.notion.create_comment.completed`,
        },
        create_database_active: {
          id: `localConversation.mcpToolActivity.notion.create_database.active`,
        },
        create_database_completed: {
          id: `localConversation.mcpToolActivity.notion.create_database.completed`,
        },
        create_pages_active: {
          id: `localConversation.mcpToolActivity.notion.create_pages.active`,
        },
        create_pages_completed: {
          id: `localConversation.mcpToolActivity.notion.create_pages.completed`,
        },
        create_view_active: {
          id: `localConversation.mcpToolActivity.notion.create_view.active`,
        },
        create_view_completed: {
          id: `localConversation.mcpToolActivity.notion.create_view.completed`,
        },
        download_attachment_active: {
          id: `localConversation.mcpToolActivity.notion.download_attachment.active`,
        },
        download_attachment_completed: {
          id: `localConversation.mcpToolActivity.notion.download_attachment.completed`,
        },
        duplicate_page_active: {
          id: `localConversation.mcpToolActivity.notion.duplicate_page.active`,
        },
        duplicate_page_completed: {
          id: `localConversation.mcpToolActivity.notion.duplicate_page.completed`,
        },
        fetch_active: {
          id: `localConversation.mcpToolActivity.notion.fetch.active`,
        },
        fetch_completed: {
          id: `localConversation.mcpToolActivity.notion.fetch.completed`,
        },
        get_comments_active: {
          id: `localConversation.mcpToolActivity.notion.get_comments.active`,
        },
        get_comments_completed: {
          id: `localConversation.mcpToolActivity.notion.get_comments.completed`,
        },
        get_teams_active: {
          id: `localConversation.mcpToolActivity.notion.get_teams.active`,
        },
        get_teams_completed: {
          id: `localConversation.mcpToolActivity.notion.get_teams.completed`,
        },
        get_users_active: {
          id: `localConversation.mcpToolActivity.notion.get_users.active`,
        },
        get_users_activeWithQuery: {
          id: `localConversation.mcpToolActivity.notion.get_users.activeWithQuery`,
        },
        get_users_completed: {
          id: `localConversation.mcpToolActivity.notion.get_users.completed`,
        },
        get_users_completedWithQuery: {
          id: `localConversation.mcpToolActivity.notion.get_users.completedWithQuery`,
        },
        move_pages_active: {
          id: `localConversation.mcpToolActivity.notion.move_pages.active`,
        },
        move_pages_completed: {
          id: `localConversation.mcpToolActivity.notion.move_pages.completed`,
        },
        query_data_sources_active: {
          id: `localConversation.mcpToolActivity.notion.query_data_sources.active`,
        },
        query_data_sources_completed: {
          id: `localConversation.mcpToolActivity.notion.query_data_sources.completed`,
        },
        query_database_view_active: {
          id: `localConversation.mcpToolActivity.notion.query_database_view.active`,
        },
        query_database_view_completed: {
          id: `localConversation.mcpToolActivity.notion.query_database_view.completed`,
        },
        query_meeting_notes_active: {
          id: `localConversation.mcpToolActivity.notion.query_meeting_notes.active`,
        },
        query_meeting_notes_activeWithQuery: {
          id: `localConversation.mcpToolActivity.notion.query_meeting_notes.activeWithQuery`,
        },
        query_meeting_notes_completed: {
          id: `localConversation.mcpToolActivity.notion.query_meeting_notes.completed`,
        },
        query_meeting_notes_completedWithQuery: {
          id: `localConversation.mcpToolActivity.notion.query_meeting_notes.completedWithQuery`,
        },
        search_active: {
          id: `localConversation.mcpToolActivity.notion.search.active`,
        },
        search_completed: {
          id: `localConversation.mcpToolActivity.notion.search.completed`,
        },
        update_data_source_active: {
          id: `localConversation.mcpToolActivity.notion.update_data_source.active`,
        },
        update_data_source_activeWithTitle: {
          id: `localConversation.mcpToolActivity.notion.update_data_source.activeWithTitle`,
        },
        update_data_source_completed: {
          id: `localConversation.mcpToolActivity.notion.update_data_source.completed`,
        },
        update_data_source_completedWithTitle: {
          id: `localConversation.mcpToolActivity.notion.update_data_source.completedWithTitle`,
        },
        update_page_active: {
          id: `localConversation.mcpToolActivity.notion.update_page.active`,
        },
        update_page_activeWithTitle: {
          id: `localConversation.mcpToolActivity.notion.update_page.activeWithTitle`,
        },
        update_page_completed: {
          id: `localConversation.mcpToolActivity.notion.update_page.completed`,
        },
        update_page_completedWithTitle: {
          id: `localConversation.mcpToolActivity.notion.update_page.completedWithTitle`,
        },
        update_view_active: {
          id: `localConversation.mcpToolActivity.notion.update_view.active`,
        },
        update_view_completed: {
          id: `localConversation.mcpToolActivity.notion.update_view.completed`,
        },
        create_database_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.create_database.activeWithVariant1`,
        },
        create_database_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.create_database.completedWithVariant1`,
        },
        create_pages_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.create_pages.activeWithVariant1`,
        },
        create_pages_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.create_pages.completedWithVariant1`,
        },
        create_pages_activeWithVariant2: {
          id: `localConversation.mcpToolActivity.notion.create_pages.activeWithVariant2`,
        },
        create_pages_completedWithVariant2: {
          id: `localConversation.mcpToolActivity.notion.create_pages.completedWithVariant2`,
        },
        create_view_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.create_view.activeWithVariant1`,
        },
        create_view_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.create_view.completedWithVariant1`,
        },
        fetch_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.fetch.activeWithVariant1`,
        },
        fetch_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.fetch.completedWithVariant1`,
        },
        query_data_sources_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.query_data_sources.activeWithVariant1`,
        },
        query_data_sources_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.query_data_sources.completedWithVariant1`,
        },
        search_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.search.activeWithVariant1`,
        },
        search_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.search.completedWithVariant1`,
        },
        update_view_activeWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.update_view.activeWithVariant1`,
        },
        update_view_completedWithVariant1: {
          id: `localConversation.mcpToolActivity.notion.update_view.completedWithVariant1`,
        },
      })));
  }))();
}
var Pi, Fi, X;
function Ii() {
  return (Ii = e(() => {
    (d(),
      c(),
      O(),
      (Pi = `sites`),
      (Fi = C({
        appRegistryKey: Pi,
        toolArgumentsSchema: f({}).strip(),
        tools: {
          create_project: w(() => ({
            active: X.create_project_active,
            completed: X.create_project_completed,
          })),
          create_project_version: w(() => ({
            active: X.create_project_version_active,
            completed: X.create_project_version_completed,
          })),
          create_site: w(() => ({
            active: X.create_site_active,
            completed: X.create_site_completed,
          })),
          create_source_repository_write_credential: w(() => ({
            active: X.create_source_repository_write_credential_active,
            completed: X.create_source_repository_write_credential_completed,
          })),
          deploy_private_site_version: w(() => ({
            active: X.deploy_private_site_version_active,
            completed: X.deploy_private_site_version_completed,
          })),
          deploy_project_version: w(() => ({
            active: X.deploy_project_version_active,
            completed: X.deploy_project_version_completed,
          })),
          deploy_site_version: w(() => ({
            active: X.deploy_site_version_active,
            completed: X.deploy_site_version_completed,
          })),
          execute_database_delete: w(() => ({
            active: X.execute_database_delete_active,
            completed: X.execute_database_delete_completed,
          })),
          execute_database_insert: w(() => ({
            active: X.execute_database_insert_active,
            completed: X.execute_database_insert_completed,
          })),
          execute_database_update: w(() => ({
            active: X.execute_database_update_active,
            completed: X.execute_database_update_completed,
          })),
          generate_siwc_bypass_token: w(() => ({
            active: X.generate_siwc_bypass_token_active,
            completed: X.generate_siwc_bypass_token_completed,
          })),
          get_deployment_status: w(() => ({
            active: X.get_deployment_status_active,
            completed: X.get_deployment_status_completed,
          })),
          get_environment: w(() => ({
            active: X.get_environment_active,
            completed: X.get_environment_completed,
          })),
          get_environment_variables: w(() => ({
            active: X.get_environment_variables_active,
            completed: X.get_environment_variables_completed,
          })),
          get_project: w(() => ({
            active: X.get_project_active,
            completed: X.get_project_completed,
          })),
          get_project_deployment: w(() => ({
            active: X.get_project_deployment_active,
            completed: X.get_project_deployment_completed,
          })),
          get_project_version: w(() => ({
            active: X.get_project_version_active,
            completed: X.get_project_version_completed,
          })),
          get_site: w(() => ({
            active: X.get_site_active,
            completed: X.get_site_completed,
          })),
          get_site_version: w(() => ({
            active: X.get_site_version_active,
            completed: X.get_site_version_completed,
          })),
          get_site_worker_logs: w(() => ({
            active: X.get_site_worker_logs_active,
            completed: X.get_site_worker_logs_completed,
          })),
          list_access_groups: w(() => ({
            active: X.list_access_groups_active,
            completed: X.list_access_groups_completed,
          })),
          list_available_access_groups: w(() => ({
            active: X.list_available_access_groups_active,
            completed: X.list_available_access_groups_completed,
          })),
          list_projects: w(() => ({
            active: X.list_projects_active,
            completed: X.list_projects_completed,
          })),
          list_site_versions: w(() => ({
            active: X.list_site_versions_active,
            completed: X.list_site_versions_completed,
          })),
          list_sites: w(() => ({
            active: X.list_sites_active,
            completed: X.list_sites_completed,
          })),
          prepare_database_delete: w(() => ({
            active: X.prepare_database_delete_active,
            completed: X.prepare_database_delete_completed,
          })),
          prepare_database_insert: w(() => ({
            active: X.prepare_database_insert_active,
            completed: X.prepare_database_insert_completed,
          })),
          prepare_database_update: w(() => ({
            active: X.prepare_database_update_active,
            completed: X.prepare_database_update_completed,
          })),
          read_database_overview: w(() => ({
            active: X.read_database_overview_active,
            completed: X.read_database_overview_completed,
          })),
          read_database_table_rows: w(() => ({
            active: X.read_database_table_rows_active,
            completed: X.read_database_table_rows_completed,
          })),
          save_site_version: w(() => ({
            active: X.save_site_version_active,
            completed: X.save_site_version_completed,
          })),
          update_access: w(() => ({
            active: X.update_access_active,
            completed: X.update_access_completed,
          })),
          update_environment: w(() => ({
            active: X.update_environment_active,
            completed: X.update_environment_completed,
          })),
          update_environment_variables: w(() => ({
            active: X.update_environment_variables_active,
            completed: X.update_environment_variables_completed,
          })),
          update_site_access: w(() => ({
            active: X.update_site_access_active,
            completed: X.update_site_access_completed,
          })),
          update_site_metadata: w(() => ({
            active: X.update_site_metadata_active,
            completed: X.update_site_metadata_completed,
          })),
        },
      })),
      (X = h({
        create_project_active: {
          id: `localConversation.mcpToolActivity.sites.create_project.active`,
        },
        create_project_completed: {
          id: `localConversation.mcpToolActivity.sites.create_project.completed`,
        },
        create_project_version_active: {
          id: `localConversation.mcpToolActivity.sites.create_project_version.active`,
        },
        create_project_version_completed: {
          id: `localConversation.mcpToolActivity.sites.create_project_version.completed`,
        },
        create_site_active: {
          id: `localConversation.mcpToolActivity.sites.create_site.active`,
        },
        create_site_completed: {
          id: `localConversation.mcpToolActivity.sites.create_site.completed`,
        },
        create_source_repository_write_credential_active: {
          id: `localConversation.mcpToolActivity.sites.create_source_repository_write_credential.active`,
        },
        create_source_repository_write_credential_completed: {
          id: `localConversation.mcpToolActivity.sites.create_source_repository_write_credential.completed`,
        },
        deploy_private_site_version_active: {
          id: `localConversation.mcpToolActivity.sites.deploy_private_site_version.active`,
        },
        deploy_private_site_version_completed: {
          id: `localConversation.mcpToolActivity.sites.deploy_private_site_version.completed`,
        },
        deploy_project_version_active: {
          id: `localConversation.mcpToolActivity.sites.deploy_project_version.active`,
        },
        deploy_project_version_completed: {
          id: `localConversation.mcpToolActivity.sites.deploy_project_version.completed`,
        },
        deploy_site_version_active: {
          id: `localConversation.mcpToolActivity.sites.deploy_site_version.active`,
        },
        deploy_site_version_completed: {
          id: `localConversation.mcpToolActivity.sites.deploy_site_version.completed`,
        },
        execute_database_update_active: {
          id: `localConversation.mcpToolActivity.sites.execute_database_update.active`,
        },
        execute_database_update_completed: {
          id: `localConversation.mcpToolActivity.sites.execute_database_update.completed`,
        },
        generate_siwc_bypass_token_active: {
          id: `localConversation.mcpToolActivity.sites.generate_siwc_bypass_token.active`,
        },
        generate_siwc_bypass_token_completed: {
          id: `localConversation.mcpToolActivity.sites.generate_siwc_bypass_token.completed`,
        },
        get_deployment_status_active: {
          id: `localConversation.mcpToolActivity.sites.get_deployment_status.active`,
        },
        get_deployment_status_completed: {
          id: `localConversation.mcpToolActivity.sites.get_deployment_status.completed`,
        },
        get_environment_active: {
          id: `localConversation.mcpToolActivity.sites.get_environment.active`,
        },
        get_environment_completed: {
          id: `localConversation.mcpToolActivity.sites.get_environment.completed`,
        },
        get_environment_variables_active: {
          id: `localConversation.mcpToolActivity.sites.get_environment_variables.active`,
        },
        get_environment_variables_completed: {
          id: `localConversation.mcpToolActivity.sites.get_environment_variables.completed`,
        },
        get_project_active: {
          id: `localConversation.mcpToolActivity.sites.get_project.active`,
        },
        get_project_completed: {
          id: `localConversation.mcpToolActivity.sites.get_project.completed`,
        },
        get_project_deployment_active: {
          id: `localConversation.mcpToolActivity.sites.get_project_deployment.active`,
        },
        get_project_deployment_completed: {
          id: `localConversation.mcpToolActivity.sites.get_project_deployment.completed`,
        },
        get_project_version_active: {
          id: `localConversation.mcpToolActivity.sites.get_project_version.active`,
        },
        get_project_version_completed: {
          id: `localConversation.mcpToolActivity.sites.get_project_version.completed`,
        },
        get_site_active: {
          id: `localConversation.mcpToolActivity.sites.get_site.active`,
        },
        get_site_completed: {
          id: `localConversation.mcpToolActivity.sites.get_site.completed`,
        },
        get_site_version_active: {
          id: `localConversation.mcpToolActivity.sites.get_site_version.active`,
        },
        get_site_version_completed: {
          id: `localConversation.mcpToolActivity.sites.get_site_version.completed`,
        },
        get_site_worker_logs_active: {
          id: `localConversation.mcpToolActivity.sites.get_site_worker_logs.active`,
        },
        get_site_worker_logs_completed: {
          id: `localConversation.mcpToolActivity.sites.get_site_worker_logs.completed`,
        },
        list_access_groups_active: {
          id: `localConversation.mcpToolActivity.sites.list_access_groups.active`,
        },
        list_access_groups_completed: {
          id: `localConversation.mcpToolActivity.sites.list_access_groups.completed`,
        },
        list_available_access_groups_active: {
          id: `localConversation.mcpToolActivity.sites.list_available_access_groups.active`,
        },
        list_available_access_groups_completed: {
          id: `localConversation.mcpToolActivity.sites.list_available_access_groups.completed`,
        },
        list_projects_active: {
          id: `localConversation.mcpToolActivity.sites.list_projects.active`,
        },
        list_projects_completed: {
          id: `localConversation.mcpToolActivity.sites.list_projects.completed`,
        },
        list_site_versions_active: {
          id: `localConversation.mcpToolActivity.sites.list_site_versions.active`,
        },
        list_site_versions_completed: {
          id: `localConversation.mcpToolActivity.sites.list_site_versions.completed`,
        },
        list_sites_active: {
          id: `localConversation.mcpToolActivity.sites.list_sites.active`,
        },
        list_sites_completed: {
          id: `localConversation.mcpToolActivity.sites.list_sites.completed`,
        },
        prepare_database_update_active: {
          id: `localConversation.mcpToolActivity.sites.prepare_database_update.active`,
        },
        prepare_database_update_completed: {
          id: `localConversation.mcpToolActivity.sites.prepare_database_update.completed`,
        },
        read_database_overview_active: {
          id: `localConversation.mcpToolActivity.sites.read_database_overview.active`,
        },
        read_database_overview_completed: {
          id: `localConversation.mcpToolActivity.sites.read_database_overview.completed`,
        },
        read_database_table_rows_active: {
          id: `localConversation.mcpToolActivity.sites.read_database_table_rows.active`,
        },
        read_database_table_rows_completed: {
          id: `localConversation.mcpToolActivity.sites.read_database_table_rows.completed`,
        },
        execute_database_delete_active: {
          id: `localConversation.mcpToolActivity.sites.execute_database_delete.active`,
        },
        execute_database_delete_completed: {
          id: `localConversation.mcpToolActivity.sites.execute_database_delete.completed`,
        },
        execute_database_insert_active: {
          id: `localConversation.mcpToolActivity.sites.execute_database_insert.active`,
        },
        execute_database_insert_completed: {
          id: `localConversation.mcpToolActivity.sites.execute_database_insert.completed`,
        },
        prepare_database_delete_active: {
          id: `localConversation.mcpToolActivity.sites.prepare_database_delete.active`,
        },
        prepare_database_delete_completed: {
          id: `localConversation.mcpToolActivity.sites.prepare_database_delete.completed`,
        },
        prepare_database_insert_active: {
          id: `localConversation.mcpToolActivity.sites.prepare_database_insert.active`,
        },
        prepare_database_insert_completed: {
          id: `localConversation.mcpToolActivity.sites.prepare_database_insert.completed`,
        },
        save_site_version_active: {
          id: `localConversation.mcpToolActivity.sites.save_site_version.active`,
        },
        save_site_version_completed: {
          id: `localConversation.mcpToolActivity.sites.save_site_version.completed`,
        },
        update_access_active: {
          id: `localConversation.mcpToolActivity.sites.update_access.active`,
        },
        update_access_completed: {
          id: `localConversation.mcpToolActivity.sites.update_access.completed`,
        },
        update_environment_active: {
          id: `localConversation.mcpToolActivity.sites.update_environment.active`,
        },
        update_environment_completed: {
          id: `localConversation.mcpToolActivity.sites.update_environment.completed`,
        },
        update_environment_variables_active: {
          id: `localConversation.mcpToolActivity.sites.update_environment_variables.active`,
        },
        update_environment_variables_completed: {
          id: `localConversation.mcpToolActivity.sites.update_environment_variables.completed`,
        },
        update_site_access_active: {
          id: `localConversation.mcpToolActivity.sites.update_site_access.active`,
        },
        update_site_access_completed: {
          id: `localConversation.mcpToolActivity.sites.update_site_access.completed`,
        },
        update_site_metadata_active: {
          id: `localConversation.mcpToolActivity.sites.update_site_metadata.active`,
        },
        update_site_metadata_completed: {
          id: `localConversation.mcpToolActivity.sites.update_site_metadata.completed`,
        },
      })));
  }))();
}
function Li(e) {
  return D({ maxLength: Yi, value: e });
}
function Ri({ fallback: e, value: t, withItemName: n }) {
  let r = Li(t);
  return r == null
    ? { descriptor: e }
    : { descriptor: n, values: { itemName: r } };
}
function zi(e) {
  let t = Li(e?.filename ?? e?.title ?? e?.source_file?.file_name);
  if (t == null) return { descriptor: Z.complete_file_upload_approval };
  let n = Li(e?.initial_comment);
  return n == null
    ? {
        descriptor: Z.complete_file_upload_approvalWithItemName,
        values: { itemName: t },
      }
    : {
        descriptor: Z.complete_file_upload_approvalWithItemNameAndComment,
        values: { initialComment: n, itemName: t },
      };
}
function Bi(e) {
  return Ri({
    fallback: Z.create_conversation_approval,
    value: e?.channel_name,
    withItemName:
      e?.is_private === !0
        ? Z.create_conversation_approvalWithPrivateChannel
        : Z.create_conversation_approvalWithPublicChannel,
  });
}
function Vi(e) {
  let t = Li(e?.message);
  return t == null || e?.post_at == null
    ? { descriptor: Z.schedule_message_approval }
    : {
        descriptor: Z.schedule_message_approvalWithTime,
        values: { itemName: t, scheduledTime: e.post_at * 1e3 },
      };
}
function Hi(e) {
  let t = Li(e?.message);
  if (t == null) return { descriptor: Z.send_message_approval };
  let n = Li(e?.conversation_name);
  return n == null
    ? {
        descriptor: Z.send_message_approvalWithItemName,
        values: { itemName: t },
      }
    : {
        descriptor: Z.send_message_approvalWithConversation,
        values: { conversationName: n, itemName: t },
      };
}
function Ui({ getMessages: e, getTarget: t }) {
  return Jt({
    getMessages: e,
    getValues: ({
      hasInvocationContext: e,
      toolArguments: n,
      toolResult: r,
    }) => {
      if (!e || n == null) return null;
      let i = Gi({ query: n.query, toolResult: r });
      return i == null ? null : { query: i, target: t(n) };
    },
  });
}
function Wi(e) {
  return Jt({
    getMessages: e,
    getValues: ({ hasInvocationContext: e, toolArguments: t }) =>
      !e || t == null || t.user_id != null ? null : {},
  });
}
function Gi({ query: e, toolResult: t }) {
  if (e == null) return null;
  let n = /<@[UW][A-Z0-9]+>/.test(e) ? Ki(t) : null,
    r = !1,
    i = e
      .replace(
        /\b(from|in|to):<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g,
        (e, t, i, a) => {
          let o = a == null ? n?.get(i) : `@${a}`;
          return o == null ? ((r = !0), `${t}:${i}`) : `${t}:${o}`;
        },
      )
      .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (e, t, i) =>
        i == null ? (n?.get(t) ?? ((r = !0), t)) : `@${i}`,
      )
      .replace(/"([^"]+)"/g, `$1`);
  return r ? null : D({ maxLength: Yi, value: i });
}
function Ki(e) {
  let t = $i.safeParse(e),
    n = new Map();
  if (!t.success) return n;
  for (let e of [...(t.data.content ?? []), ...(t.data.raw?.content ?? [])])
    for (let t of e.text.matchAll(
      /From:\s*([^\n(]+?)\s*\(ID:\s*([UW][A-Z0-9]+)\)/g,
    ))
      n.set(t[2], t[1].trim());
  return n;
}
function qi({ content_types: e }) {
  let t =
    e
      ?.split(`,`)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0) ?? [];
  return t.length === 1 && t[0] === `files`
    ? `files`
    : t.length === 2 && t.includes(`files`) && t.includes(`messages`)
      ? `messagesAndFiles`
      : `messages`;
}
var Ji, Yi, Xi, Zi, Qi, $i, ea, ta, na, Z;
function ra() {
  return (ra = e(() => {
    (d(),
      c(),
      O(),
      (Ji = `slack`),
      (Yi = 36),
      (Xi = te([
        p().trim().min(1).max(5e3),
        f({
          markdown_text: p()
            .trim()
            .min(1)
            .max(5e3)
            .optional()
            .catch(void 0),
          text: p()
            .trim()
            .min(1)
            .max(5e3)
            .optional()
            .catch(void 0),
        })
          .strip()
          .transform(({ markdown_text: e, text: t }) => e ?? t),
      ])
        .optional()
        .catch(void 0)),
      (Zi = f({
        channel_name: p()
          .trim()
          .min(1)
          .max(80)
          .optional()
          .catch(void 0),
        content_types: p()
          .trim()
          .min(1)
          .max(64)
          .optional()
          .catch(void 0),
        conversation_name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        emoji: p()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .catch(void 0),
        filename: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        initial_comment: p()
          .trim()
          .min(1)
          .max(5e3)
          .optional()
          .catch(void 0),
        is_private: g()
          .optional()
          .catch(void 0),
        limit: _()
          .int()
          .positive()
          .optional()
          .catch(void 0),
        message: Xi,
        post_at: _()
          .int()
          .nonnegative()
          .optional()
          .catch(void 0),
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        source_file: f({
          file_name: p()
            .trim()
            .min(1)
            .max(200)
            .optional()
            .catch(void 0),
        })
          .strip()
          .optional()
          .catch(void 0),
        title: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        user_id: p()
          .trim()
          .min(1)
          .max(32)
          .optional()
          .catch(void 0),
      }).loose()),
      (Qi = f({ text: p(), type: ne(`text`) }).loose()),
      ($i = f({
        content: r(Qi)
          .optional()
          .catch(void 0),
        raw: f({
          content: r(Qi)
            .optional()
            .catch(void 0),
        })
          .loose()
          .optional()
          .catch(void 0),
        type: ne(`success`),
      }).loose()),
      (ea = {
        add_reaction: w(
          () => ({
            active: Z.add_reaction_active,
            completed: Z.add_reaction_completed,
          }),
          (e) =>
            Ri({
              fallback: Z.add_reaction_approval,
              value: e?.emoji,
              withItemName: Z.add_reaction_approvalWithEmoji,
            }),
        ),
        complete_file_upload: w(
          () => ({
            active: Z.complete_file_upload_active,
            completed: Z.complete_file_upload_completed,
          }),
          zi,
        ),
        create_canvas: T({
          getItemName: (e) => e.title,
          getMessages: () => ({
            withoutContext: {
              active: Z.create_canvas_active,
              completed: Z.create_canvas_completed,
            },
            withContext: {
              active: Z.create_canvas_activeWithContext,
              completed: Z.create_canvas_completedWithContext,
            },
          }),
          maxPreviewLength: Yi,
          approval: (e) =>
            Ri({
              fallback: Z.create_canvas_approval,
              value: e?.title,
              withItemName: Z.create_canvas_approvalWithItemName,
            }),
        }),
        create_conversation: w(
          () => ({
            active: Z.create_conversation_active,
            completed: Z.create_conversation_completed,
          }),
          Bi,
        ),
        create_reminder: w(() => ({
          active: Z.create_reminder_active,
          completed: Z.create_reminder_completed,
        })),
        delete_message: w(
          () => ({
            active: Z.delete_message_active,
            completed: Z.delete_message_completed,
          }),
          () => ({ descriptor: Z.delete_message_approval }),
        ),
        edit_message: w(
          () => ({
            active: Z.edit_message_active,
            completed: Z.edit_message_completed,
          }),
          (e) =>
            Ri({
              fallback: Z.edit_message_approval,
              value: e?.message,
              withItemName: Z.edit_message_approvalWithMessage,
            }),
        ),
        get_file_upload_url: w(
          () => ({
            active: Z.get_file_upload_url_active,
            completed: Z.get_file_upload_url_completed,
          }),
          (e) =>
            Ri({
              fallback: Z.get_file_upload_url_approval,
              value: e?.filename,
              withItemName: Z.get_file_upload_url_approvalWithItemName,
            }),
        ),
        get_reactions: w(() => ({
          active: Z.get_reactions_active,
          completed: Z.get_reactions_completed,
        })),
        invite_to_conversation: w(
          () => ({
            active: Z.invite_to_conversation_active,
            completed: Z.invite_to_conversation_completed,
          }),
          () => ({ descriptor: Z.invite_to_conversation_approval }),
        ),
        join_conversation: w(
          () => ({
            active: Z.join_conversation_active,
            completed: Z.join_conversation_completed,
          }),
          () => ({ descriptor: Z.join_conversation_approval }),
        ),
        leave_conversation: w(
          () => ({
            active: Z.leave_conversation_active,
            completed: Z.leave_conversation_completed,
          }),
          () => ({ descriptor: Z.leave_conversation_approval }),
        ),
        list_channel_members: w(() => ({
          active: Z.list_channel_members_active,
          completed: Z.list_channel_members_completed,
        })),
        list_starred_items: w(() => ({
          active: Z.list_starred_items_active,
          completed: Z.list_starred_items_completed,
        })),
        list_user_conversations: w(() => ({
          active: Z.list_user_conversations_active,
          completed: Z.list_user_conversations_completed,
        })),
        list_user_groups: w(() => ({
          active: Z.list_user_groups_active,
          completed: Z.list_user_groups_completed,
        })),
        list_workspaces: w(() => ({
          active: Z.list_workspaces_active,
          completed: Z.list_workspaces_completed,
        })),
        read_canvas: w(() => ({
          active: Z.read_canvas_active,
          completed: Z.read_canvas_completed,
        })),
        read_channel: Yt({
          getMessages: () => ({
            completedCount: Z.read_channel_completedCount,
            withoutContext: {
              active: Z.read_channel_active,
              completed: Z.read_channel_completed,
            },
            withContext: {
              active: Z.read_channel_activeWithContext,
              completed: Z.read_channel_completedWithContext,
            },
          }),
          preferredKeys: [`messages`],
        }),
        read_file: w(() => ({
          active: Z.read_file_active,
          completed: Z.read_file_completed,
        })),
        read_thread: Yt({
          getMessages: () => ({
            completedCount: Z.read_thread_completedCount,
            withoutContext: {
              active: Z.read_thread_active,
              completed: Z.read_thread_completed,
            },
            withContext: {
              active: Z.read_thread_activeWithContext,
              completed: Z.read_thread_completedWithContext,
            },
          }),
          preferredKeys: [`replies`, `messages`],
        }),
        read_user_profile: Wi(() => ({
          withoutContext: {
            active: Z.read_user_profile_active,
            completed: Z.read_user_profile_completed,
          },
          withContext: {
            active: Z.read_user_profile_activeWithContext,
            completed: Z.read_user_profile_completedWithContext,
          },
        })),
        remove_reaction: w(
          () => ({
            active: Z.remove_reaction_active,
            completed: Z.remove_reaction_completed,
          }),
          (e) =>
            Ri({
              fallback: Z.remove_reaction_approval,
              value: e?.emoji,
              withItemName: Z.remove_reaction_approvalWithEmoji,
            }),
        ),
        schedule_message: T({
          getItemName: (e) => e.message,
          getMessages: () => ({
            withoutContext: {
              active: Z.schedule_message_active,
              completed: Z.schedule_message_completed,
            },
            withContext: {
              active: Z.schedule_message_activeWithContext,
              completed: Z.schedule_message_completedWithContext,
            },
          }),
          maxPreviewLength: Yi,
          approval: Vi,
        }),
        search_channels: Ui({
          getMessages: () => ({
            withoutContext: {
              active: Z.search_channels_active,
              completed: Z.search_channels_completed,
            },
            withContext: {
              active: Z.search_channels_activeWithContext,
              completed: Z.search_channels_completedWithContext,
            },
          }),
          getTarget: () => `channels`,
        }),
        search_emojis: w(() => ({
          active: Z.search_emojis_active,
          completed: Z.search_emojis_completed,
        })),
        search_public: Ui({
          getMessages: () => ({
            withoutContext: {
              active: Z.search_public_active,
              completed: Z.search_public_completed,
            },
            withContext: {
              active: Z.search_public_activeWithContext,
              completed: Z.search_public_completedWithContext,
            },
          }),
          getTarget: qi,
        }),
        search_public_and_private: Ui({
          getMessages: () => ({
            withoutContext: {
              active: Z.search_public_active,
              completed: Z.search_public_completed,
            },
            withContext: {
              active: Z.search_public_activeWithContext,
              completed: Z.search_public_completedWithContext,
            },
          }),
          getTarget: qi,
        }),
        search_users: Ui({
          getMessages: () => ({
            withoutContext: {
              active: Z.search_users_active,
              completed: Z.search_users_completed,
            },
            withContext: {
              active: Z.search_users_activeWithContext,
              completed: Z.search_users_completedWithContext,
            },
          }),
          getTarget: () => `users`,
        }),
        send_message: T({
          getItemName: (e) => e.message,
          getMessages: () => ({
            withoutContext: {
              active: Z.send_message_active,
              completed: Z.send_message_completed,
            },
            withContext: {
              active: Z.send_message_activeWithContext,
              completed: Z.send_message_completedWithContext,
            },
          }),
          maxPreviewLength: Yi,
          approval: Hi,
        }),
        send_message_draft: T({
          getItemName: (e) => e.message,
          getMessages: () => ({
            withoutContext: {
              active: Z.send_message_draft_active,
              completed: Z.send_message_draft_completed,
            },
            withContext: {
              active: Z.send_message_draft_activeWithContext,
              completed: Z.send_message_draft_completedWithContext,
            },
          }),
          maxPreviewLength: Yi,
          approval: (e) =>
            Ri({
              fallback: Z.send_message_draft_approval,
              value: e?.message,
              withItemName: Z.send_message_draft_approvalWithItemName,
            }),
        }),
        update_canvas: w(
          () => ({
            active: Z.update_canvas_active,
            completed: Z.update_canvas_completed,
          }),
          () => ({ descriptor: Z.update_canvas_approval }),
        ),
        update_user_profile: w(() => ({
          active: Z.update_user_profile_active,
          completed: Z.update_user_profile_completed,
        })),
      }),
      (ta = C({ appRegistryKey: Ji, toolArgumentsSchema: Zi, tools: ea })),
      (na = qt({ toolArgumentsSchema: Zi, tools: ea })),
      (Z = h({
        add_reaction_approval: {
          id: `localConversation.mcpToolApproval.slack.add_reaction.fallback`,
        },
        add_reaction_approvalWithEmoji: {
          id: `localConversation.mcpToolApproval.slack.add_reaction.emoji`,
        },
        complete_file_upload_approval: {
          id: `localConversation.mcpToolApproval.slack.complete_file_upload.fallback`,
        },
        complete_file_upload_approvalWithItemName: {
          id: `localConversation.mcpToolApproval.slack.complete_file_upload.itemName`,
        },
        complete_file_upload_approvalWithItemNameAndComment: {
          id: `localConversation.mcpToolApproval.slack.complete_file_upload.itemNameAndComment`,
        },
        create_canvas_approval: {
          id: `localConversation.mcpToolApproval.slack.create_canvas.fallback`,
        },
        create_canvas_approvalWithItemName: {
          id: `localConversation.mcpToolApproval.slack.create_canvas.itemName`,
        },
        create_conversation_approval: {
          id: `localConversation.mcpToolApproval.slack.create_conversation.fallback`,
        },
        create_conversation_approvalWithPrivateChannel: {
          id: `localConversation.mcpToolApproval.slack.create_conversation.privateChannel`,
        },
        create_conversation_approvalWithPublicChannel: {
          id: `localConversation.mcpToolApproval.slack.create_conversation.publicChannel`,
        },
        delete_message_approval: {
          id: `localConversation.mcpToolApproval.slack.delete_message.fallback`,
        },
        edit_message_approval: {
          id: `localConversation.mcpToolApproval.slack.edit_message.fallback`,
        },
        edit_message_approvalWithMessage: {
          id: `localConversation.mcpToolApproval.slack.edit_message.message`,
        },
        get_file_upload_url_approval: {
          id: `localConversation.mcpToolApproval.slack.get_file_upload_url.fallback`,
        },
        get_file_upload_url_approvalWithItemName: {
          id: `localConversation.mcpToolApproval.slack.get_file_upload_url.itemName`,
        },
        invite_to_conversation_approval: {
          id: `localConversation.mcpToolApproval.slack.invite_to_conversation.fallback`,
        },
        join_conversation_approval: {
          id: `localConversation.mcpToolApproval.slack.join_conversation.fallback`,
        },
        leave_conversation_approval: {
          id: `localConversation.mcpToolApproval.slack.leave_conversation.fallback`,
        },
        remove_reaction_approval: {
          id: `localConversation.mcpToolApproval.slack.remove_reaction.fallback`,
        },
        remove_reaction_approvalWithEmoji: {
          id: `localConversation.mcpToolApproval.slack.remove_reaction.emoji`,
        },
        schedule_message_approval: {
          id: `localConversation.mcpToolApproval.slack.schedule_message.fallback`,
        },
        schedule_message_approvalWithTime: {
          id: `localConversation.mcpToolApproval.slack.schedule_message.itemNameAndTime`,
        },
        send_message_approval: {
          id: `localConversation.mcpToolApproval.slack.send_message.fallback`,
        },
        send_message_approvalWithItemName: {
          id: `localConversation.mcpToolApproval.slack.send_message.itemName`,
        },
        send_message_approvalWithConversation: {
          id: `localConversation.mcpToolApproval.slack.send_message.itemNameAndConversation`,
        },
        send_message_draft_approval: {
          id: `localConversation.mcpToolApproval.slack.send_message_draft.fallback`,
        },
        send_message_draft_approvalWithItemName: {
          id: `localConversation.mcpToolApproval.slack.send_message_draft.itemName`,
        },
        update_canvas_approval: {
          id: `localConversation.mcpToolApproval.slack.update_canvas.fallback`,
        },
        add_reaction_active: {
          id: `localConversation.mcpToolActivity.slack.add_reaction.active`,
        },
        add_reaction_completed: {
          id: `localConversation.mcpToolActivity.slack.add_reaction.completed`,
        },
        complete_file_upload_active: {
          id: `localConversation.mcpToolActivity.slack.complete_file_upload.active`,
        },
        complete_file_upload_completed: {
          id: `localConversation.mcpToolActivity.slack.complete_file_upload.completed`,
        },
        create_canvas_active: {
          id: `localConversation.mcpToolActivity.slack.create_canvas.active`,
        },
        create_canvas_completed: {
          id: `localConversation.mcpToolActivity.slack.create_canvas.completed`,
        },
        create_canvas_activeWithContext: {
          id: `localConversation.mcpToolActivity.slack.create_canvas.activeWithContext`,
        },
        create_canvas_completedWithContext: {
          id: `localConversation.mcpToolActivity.slack.create_canvas.completedWithContext`,
        },
        create_conversation_active: {
          id: `localConversation.mcpToolActivity.slack.create_conversation.active`,
        },
        create_conversation_completed: {
          id: `localConversation.mcpToolActivity.slack.create_conversation.completed`,
        },
        create_reminder_active: {
          id: `localConversation.mcpToolActivity.slack.create_reminder.active`,
        },
        create_reminder_completed: {
          id: `localConversation.mcpToolActivity.slack.create_reminder.completed`,
        },
        delete_message_active: {
          id: `localConversation.mcpToolActivity.slack.delete_message.active`,
        },
        delete_message_completed: {
          id: `localConversation.mcpToolActivity.slack.delete_message.completed`,
        },
        edit_message_active: {
          id: `localConversation.mcpToolActivity.slack.edit_message.active`,
        },
        edit_message_completed: {
          id: `localConversation.mcpToolActivity.slack.edit_message.completed`,
        },
        get_file_upload_url_active: {
          id: `localConversation.mcpToolActivity.slack.get_file_upload_url.active`,
        },
        get_file_upload_url_completed: {
          id: `localConversation.mcpToolActivity.slack.get_file_upload_url.completed`,
        },
        get_reactions_active: {
          id: `localConversation.mcpToolActivity.slack.get_reactions.active`,
        },
        get_reactions_completed: {
          id: `localConversation.mcpToolActivity.slack.get_reactions.completed`,
        },
        invite_to_conversation_active: {
          id: `localConversation.mcpToolActivity.slack.invite_to_conversation.active`,
        },
        invite_to_conversation_completed: {
          id: `localConversation.mcpToolActivity.slack.invite_to_conversation.completed`,
        },
        join_conversation_active: {
          id: `localConversation.mcpToolActivity.slack.join_conversation.active`,
        },
        join_conversation_completed: {
          id: `localConversation.mcpToolActivity.slack.join_conversation.completed`,
        },
        leave_conversation_active: {
          id: `localConversation.mcpToolActivity.slack.leave_conversation.active`,
        },
        leave_conversation_completed: {
          id: `localConversation.mcpToolActivity.slack.leave_conversation.completed`,
        },
        list_channel_members_active: {
          id: `localConversation.mcpToolActivity.slack.list_channel_members.active`,
        },
        list_channel_members_completed: {
          id: `localConversation.mcpToolActivity.slack.list_channel_members.completed`,
        },
        list_starred_items_active: {
          id: `localConversation.mcpToolActivity.slack.list_starred_items.active`,
        },
        list_starred_items_completed: {
          id: `localConversation.mcpToolActivity.slack.list_starred_items.completed`,
        },
        list_user_conversations_active: {
          id: `localConversation.mcpToolActivity.slack.list_user_conversations.active`,
        },
        list_user_conversations_completed: {
          id: `localConversation.mcpToolActivity.slack.list_user_conversations.completed`,
        },
        list_user_groups_active: {
          id: `localConversation.mcpToolActivity.slack.list_user_groups.active`,
        },
        list_user_groups_completed: {
          id: `localConversation.mcpToolActivity.slack.list_user_groups.completed`,
        },
        list_workspaces_active: {
          id: `localConversation.mcpToolActivity.slack.list_workspaces.active`,
        },
        list_workspaces_completed: {
          id: `localConversation.mcpToolActivity.slack.list_workspaces.completed`,
        },
        read_canvas_active: {
          id: `localConversation.mcpToolActivity.slack.read_canvas.active`,
        },
        read_canvas_completed: {
          id: `localConversation.mcpToolActivity.slack.read_canvas.completed`,
        },
        read_channel_active: {
          id: `localConversation.mcpToolActivity.slack.read_channel.active`,
        },
        read_channel_completed: {
          id: `localConversation.mcpToolActivity.slack.read_channel.completed`,
        },
        read_channel_activeWithContext: {
          id: `codex.mcpTool.slack.readMessages.active`,
        },
        read_channel_completedWithContext: {
          id: `codex.mcpTool.slack.readMessages.completed`,
        },
        read_channel_completedCount: {
          id: `codex.mcpTool.slack.readMessages.completedCount`,
        },
        read_file_active: {
          id: `localConversation.mcpToolActivity.slack.read_file.active`,
        },
        read_file_completed: {
          id: `localConversation.mcpToolActivity.slack.read_file.completed`,
        },
        read_thread_active: {
          id: `localConversation.mcpToolActivity.slack.read_thread.active`,
        },
        read_thread_completed: {
          id: `localConversation.mcpToolActivity.slack.read_thread.completed`,
        },
        read_thread_activeWithContext: {
          id: `codex.mcpTool.slack.readThreadReplies.active`,
        },
        read_thread_completedWithContext: {
          id: `codex.mcpTool.slack.readThreadReplies.completed`,
        },
        read_thread_completedCount: {
          id: `codex.mcpTool.slack.readThreadReplies.completedCount`,
        },
        read_user_profile_active: {
          id: `localConversation.mcpToolActivity.slack.read_user_profile.active`,
        },
        read_user_profile_completed: {
          id: `localConversation.mcpToolActivity.slack.read_user_profile.completed`,
        },
        read_user_profile_activeWithContext: {
          id: `codex.mcpTool.slack.readYourProfile.active`,
        },
        read_user_profile_completedWithContext: {
          id: `codex.mcpTool.slack.readYourProfile.completed`,
        },
        remove_reaction_active: {
          id: `localConversation.mcpToolActivity.slack.remove_reaction.active`,
        },
        remove_reaction_completed: {
          id: `localConversation.mcpToolActivity.slack.remove_reaction.completed`,
        },
        schedule_message_active: {
          id: `localConversation.mcpToolActivity.slack.schedule_message.active`,
        },
        schedule_message_completed: {
          id: `localConversation.mcpToolActivity.slack.schedule_message.completed`,
        },
        schedule_message_activeWithContext: {
          id: `localConversation.mcpToolActivity.slack.schedule_message.activeWithContext`,
        },
        schedule_message_completedWithContext: {
          id: `localConversation.mcpToolActivity.slack.schedule_message.completedWithContext`,
        },
        search_channels_active: {
          id: `localConversation.mcpToolActivity.slack.search_channels.active`,
        },
        search_channels_completed: {
          id: `localConversation.mcpToolActivity.slack.search_channels.completed`,
        },
        search_channels_activeWithContext: {
          id: `localConversation.mcpToolActivity.slack.search_channels.activeWithContext`,
        },
        search_channels_completedWithContext: {
          id: `localConversation.mcpToolActivity.slack.search_channels.completedWithContext`,
        },
        search_emojis_active: {
          id: `localConversation.mcpToolActivity.slack.search_emojis.active`,
        },
        search_emojis_completed: {
          id: `localConversation.mcpToolActivity.slack.search_emojis.completed`,
        },
        search_public_active: {
          id: `localConversation.mcpToolActivity.slack.search_public.active`,
        },
        search_public_completed: {
          id: `localConversation.mcpToolActivity.slack.search_public.completed`,
        },
        search_public_activeWithContext: {
          id: `localConversation.mcpToolActivity.slack.search_public.activeWithContext`,
        },
        search_public_completedWithContext: {
          id: `localConversation.mcpToolActivity.slack.search_public.completedWithContext`,
        },
        search_users_active: {
          id: `localConversation.mcpToolActivity.slack.search_users.active`,
        },
        search_users_completed: {
          id: `localConversation.mcpToolActivity.slack.search_users.completed`,
        },
        search_users_activeWithContext: {
          id: `localConversation.mcpToolActivity.slack.search_users.activeWithContext`,
        },
        search_users_completedWithContext: {
          id: `localConversation.mcpToolActivity.slack.search_users.completedWithContext`,
        },
        send_message_active: {
          id: `localConversation.mcpToolActivity.slack.send_message.active`,
        },
        send_message_completed: {
          id: `localConversation.mcpToolActivity.slack.send_message.completed`,
        },
        send_message_activeWithContext: {
          id: `localConversation.mcpToolActivity.slack.send_message.activeWithContext`,
        },
        send_message_completedWithContext: {
          id: `localConversation.mcpToolActivity.slack.send_message.completedWithContext`,
        },
        send_message_draft_active: {
          id: `localConversation.mcpToolActivity.slack.send_message_draft.active`,
        },
        send_message_draft_completed: {
          id: `localConversation.mcpToolActivity.slack.send_message_draft.completed`,
        },
        send_message_draft_activeWithContext: {
          id: `localConversation.mcpToolActivity.slack.send_message_draft.activeWithContext`,
        },
        send_message_draft_completedWithContext: {
          id: `localConversation.mcpToolActivity.slack.send_message_draft.completedWithContext`,
        },
        update_canvas_active: {
          id: `localConversation.mcpToolActivity.slack.update_canvas.active`,
        },
        update_canvas_completed: {
          id: `localConversation.mcpToolActivity.slack.update_canvas.completed`,
        },
        update_user_profile_active: {
          id: `localConversation.mcpToolActivity.slack.update_user_profile.active`,
        },
        update_user_profile_completed: {
          id: `localConversation.mcpToolActivity.slack.update_user_profile.completed`,
        },
      })));
  }))();
}
function ia() {
  let e = (e, t) => {
    let n = e.toolArguments;
    if (n != null) {
      let r = D({ maxLength: Q, value: aa(n) });
      if (r != null)
        return t === `active`
          ? e.intl.formatMessage($.list_deployments_activeWithProject, {
              target: r,
            })
          : e.intl.formatMessage($.list_deployments_completedWithProject, {
              target: r,
            });
      let i = D({ maxLength: Q, value: oa(n) });
      if (i != null)
        return t === `active`
          ? e.intl.formatMessage($.list_deployments_activeWithTeam, {
              target: i,
            })
          : e.intl.formatMessage($.list_deployments_completedWithTeam, {
              target: i,
            });
    }
    return t === `active`
      ? e.intl.formatMessage($.list_deployments_active)
      : e.intl.formatMessage($.list_deployments_completed);
  };
  return { active: (t) => e(t, `active`), completed: (t) => e(t, `completed`) };
}
function aa({
  idOrName: e,
  name: t,
  project: n,
  project_id: r,
  project_name: i,
  projectId: a,
  projectName: o,
}) {
  return ua(i ?? o ?? n ?? e ?? t ?? r ?? a);
}
function oa({ team: e, team_id: t, team_slug: n, teamId: r, teamSlug: i }) {
  return ua(e ?? n ?? i ?? t ?? r);
}
function sa({
  deployment: e,
  deployment_id: t,
  deployment_url: n,
  deploymentId: r,
  deploymentUrl: i,
  url: a,
}) {
  let o = n ?? i ?? a ?? e ?? t ?? r;
  if (o != null) return da(o) ?? la(o) ?? ua(o);
}
function ca(e) {
  return ua(
    (e == null ? `` : (da(e) ?? e.trim())).match(
      /^(.*)-git-[^-]+-[^.]+\.vercel\.app$/i,
    )?.[1],
  );
}
function la(e) {
  if (e == null) return;
  let t = da(e) ?? e.trim();
  if (t.length !== 0 && !t.includes(`/`) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t))
    return t.toLowerCase();
}
function ua(e) {
  if (e == null) return;
  let t = e.trim();
  if (
    !(
      t.length === 0 ||
      /^(dpl|prj|team)_[a-z0-9]{6,}$/i.test(t) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        t,
      )
    )
  )
    return t;
}
function da(e) {
  if (/^https?:\/\//i.test(e))
    try {
      return new URL(e).hostname;
    } catch {
      return;
    }
}
var fa, Q, pa, ma, ha, $;
function ga() {
  return (ga = e(() => {
    (d(),
      c(),
      O(),
      (fa = `vercel`),
      (Q = 40),
      (pa = f({
        deployment: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        deployment_id: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        deployment_url: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        deploymentId: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        deploymentUrl: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        domain: p()
          .trim()
          .min(1)
          .max(253)
          .optional()
          .catch(void 0),
        idOrName: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        project: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        project_id: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        project_name: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        projectId: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        projectName: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        query: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
        team: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        team_id: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        team_slug: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        teamId: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        teamSlug: p()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .catch(void 0),
        url: p()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .catch(void 0),
      }).strip()),
      (ma = {
        check_domain_availability_and_price: T({
          getItemName: ({ domain: e }) => la(e),
          getMessages: () => ({
            withoutContext: {
              active: $.check_domain_availability_and_price_active,
              completed: $.check_domain_availability_and_price_completed,
            },
            withContext: {
              active: $.check_domain_availability_and_price_activeWithContext,
              completed:
                $.check_domain_availability_and_price_completedWithContext,
            },
          }),
          maxPreviewLength: Q,
        }),
        deploy_to_vercel: T({
          getItemName: aa,
          getMessages: () => ({
            withoutContext: {
              active: $.deploy_to_vercel_active,
              completed: $.deploy_to_vercel_completed,
            },
            withContext: {
              active: $.deploy_to_vercel_activeWithContext,
              completed: $.deploy_to_vercel_completedWithContext,
            },
          }),
          maxPreviewLength: Q,
        }),
        get_access_to_vercel_url: T({
          getItemName: sa,
          getMessages: () => ({
            withoutContext: {
              active: $.get_access_to_vercel_url_active,
              completed: $.get_access_to_vercel_url_completed,
            },
            withContext: {
              active: $.get_access_to_vercel_url_activeWithContext,
              completed: $.get_access_to_vercel_url_completedWithContext,
            },
          }),
          maxPreviewLength: Q,
        }),
        get_deployment: T({
          getItemName: sa,
          getMessages: () => ({
            withoutContext: {
              active: $.get_deployment_active,
              completed: $.get_deployment_completed,
            },
            withContext: {
              active: $.get_deployment_activeWithContext,
              completed: $.get_deployment_completedWithContext,
            },
          }),
          maxPreviewLength: Q,
        }),
        get_deployment_build_logs: Jt({
          getMessages: () => ({
            withoutContext: {
              active: $.get_deployment_build_logs_active,
              completed: $.get_deployment_build_logs_completed,
            },
            withContext: {
              active: $.get_deployment_build_logs_activeWithTarget,
              completed: $.get_deployment_build_logs_completedWithTarget,
            },
          }),
          getValues: ({ hasInvocationContext: e, toolArguments: t }) => {
            if (!e || t == null) return null;
            let n = sa(t),
              r = aa(t) ?? ca(n) ?? D({ maxLength: Q, value: n });
            return r == null ? null : { target: r };
          },
        }),
        get_project: T({
          getItemName: aa,
          getMessages: () => ({
            withoutContext: {
              active: $.get_project_active,
              completed: $.get_project_completed,
            },
            withContext: {
              active: $.get_project_activeWithContext,
              completed: $.get_project_completedWithContext,
            },
          }),
          maxPreviewLength: Q,
        }),
        import_claude_design_from_url: w(() => ({
          active: $.import_claude_design_from_url_active,
          completed: $.import_claude_design_from_url_completed,
        })),
        list_deployments: ia(),
        list_projects: E({
          getMessages: () => ({
            withoutContext: {
              active: $.list_projects_active,
              completed: $.list_projects_completed,
            },
            withContext: {
              active: $.list_projects_activeWithTeam,
              completed: $.list_projects_completedWithTeam,
            },
          }),
          getValue: oa,
          maxPreviewLength: Q,
          valueName: `target`,
        }),
        list_teams: E({
          getMessages: () => ({
            withoutContext: {
              active: $.list_teams_active,
              completed: $.list_teams_completed,
            },
            withContext: {
              active: $.list_teams_activeWithQuery,
              completed: $.list_teams_completedWithQuery,
            },
          }),
          getValue: ({ query: e }) => e,
          maxPreviewLength: Q,
          valueName: `query`,
        }),
        search_vercel_documentation: E({
          getMessages: () => ({
            withoutContext: {
              active: $.search_vercel_documentation_active,
              completed: $.search_vercel_documentation_completed,
            },
            withContext: {
              active: $.search_vercel_documentation_activeWithQuery,
              completed: $.search_vercel_documentation_completedWithQuery,
            },
          }),
          getValue: ({ query: e }) => e,
          maxPreviewLength: Q,
          valueName: `query`,
        }),
        web_fetch_vercel_url: T({
          getItemName: sa,
          getMessages: () => ({
            withoutContext: {
              active: $.web_fetch_vercel_url_active,
              completed: $.web_fetch_vercel_url_completed,
            },
            withContext: {
              active: $.web_fetch_vercel_url_activeWithContext,
              completed: $.web_fetch_vercel_url_completedWithContext,
            },
          }),
          maxPreviewLength: Q,
        }),
      }),
      (ha = C({ appRegistryKey: fa, toolArgumentsSchema: pa, tools: ma })),
      ($ = h({
        check_domain_availability_and_price_active: {
          id: `localConversation.mcpToolActivity.vercel.check_domain_availability_and_price.active`,
        },
        check_domain_availability_and_price_completed: {
          id: `localConversation.mcpToolActivity.vercel.check_domain_availability_and_price.completed`,
        },
        check_domain_availability_and_price_activeWithContext: {
          id: `localConversation.mcpToolActivity.vercel.check_domain_availability_and_price.activeWithContext`,
        },
        check_domain_availability_and_price_completedWithContext: {
          id: `localConversation.mcpToolActivity.vercel.check_domain_availability_and_price.completedWithContext`,
        },
        deploy_to_vercel_active: {
          id: `localConversation.mcpToolActivity.vercel.deploy_to_vercel.active`,
        },
        deploy_to_vercel_completed: {
          id: `localConversation.mcpToolActivity.vercel.deploy_to_vercel.completed`,
        },
        deploy_to_vercel_activeWithContext: {
          id: `localConversation.mcpToolActivity.vercel.deploy_to_vercel.activeWithContext`,
        },
        deploy_to_vercel_completedWithContext: {
          id: `localConversation.mcpToolActivity.vercel.deploy_to_vercel.completedWithContext`,
        },
        get_access_to_vercel_url_active: {
          id: `localConversation.mcpToolActivity.vercel.get_access_to_vercel_url.active`,
        },
        get_access_to_vercel_url_completed: {
          id: `localConversation.mcpToolActivity.vercel.get_access_to_vercel_url.completed`,
        },
        get_access_to_vercel_url_activeWithContext: {
          id: `localConversation.mcpToolActivity.vercel.get_access_to_vercel_url.activeWithContext`,
        },
        get_access_to_vercel_url_completedWithContext: {
          id: `localConversation.mcpToolActivity.vercel.get_access_to_vercel_url.completedWithContext`,
        },
        get_deployment_active: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment.active`,
        },
        get_deployment_completed: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment.completed`,
        },
        get_deployment_activeWithContext: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment.activeWithContext`,
        },
        get_deployment_completedWithContext: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment.completedWithContext`,
        },
        get_deployment_build_logs_active: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment_build_logs.active`,
        },
        get_deployment_build_logs_completed: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment_build_logs.completed`,
        },
        get_deployment_build_logs_activeWithTarget: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment_build_logs.activeWithTarget`,
        },
        get_deployment_build_logs_completedWithTarget: {
          id: `localConversation.mcpToolActivity.vercel.get_deployment_build_logs.completedWithTarget`,
        },
        get_project_active: {
          id: `localConversation.mcpToolActivity.vercel.get_project.active`,
        },
        get_project_completed: {
          id: `localConversation.mcpToolActivity.vercel.get_project.completed`,
        },
        get_project_activeWithContext: {
          id: `localConversation.mcpToolActivity.vercel.get_project.activeWithContext`,
        },
        get_project_completedWithContext: {
          id: `localConversation.mcpToolActivity.vercel.get_project.completedWithContext`,
        },
        import_claude_design_from_url_active: {
          id: `localConversation.mcpToolActivity.vercel.import-claude-design-from-url.active`,
        },
        import_claude_design_from_url_completed: {
          id: `localConversation.mcpToolActivity.vercel.import-claude-design-from-url.completed`,
        },
        list_deployments_active: {
          id: `localConversation.mcpToolActivity.vercel.list_deployments.active`,
        },
        list_deployments_completed: {
          id: `localConversation.mcpToolActivity.vercel.list_deployments.completed`,
        },
        list_deployments_activeWithProject: {
          id: `localConversation.mcpToolActivity.vercel.list_deployments.activeWithProject`,
        },
        list_deployments_completedWithProject: {
          id: `localConversation.mcpToolActivity.vercel.list_deployments.completedWithProject`,
        },
        list_deployments_activeWithTeam: {
          id: `localConversation.mcpToolActivity.vercel.list_deployments.activeWithTeam`,
        },
        list_deployments_completedWithTeam: {
          id: `localConversation.mcpToolActivity.vercel.list_deployments.completedWithTeam`,
        },
        list_projects_active: {
          id: `localConversation.mcpToolActivity.vercel.list_projects.active`,
        },
        list_projects_completed: {
          id: `localConversation.mcpToolActivity.vercel.list_projects.completed`,
        },
        list_projects_activeWithTeam: {
          id: `localConversation.mcpToolActivity.vercel.list_projects.activeWithTeam`,
        },
        list_projects_completedWithTeam: {
          id: `localConversation.mcpToolActivity.vercel.list_projects.completedWithTeam`,
        },
        list_teams_active: {
          id: `localConversation.mcpToolActivity.vercel.list_teams.active`,
        },
        list_teams_completed: {
          id: `localConversation.mcpToolActivity.vercel.list_teams.completed`,
        },
        list_teams_activeWithQuery: {
          id: `localConversation.mcpToolActivity.vercel.list_teams.activeWithQuery`,
        },
        list_teams_completedWithQuery: {
          id: `localConversation.mcpToolActivity.vercel.list_teams.completedWithQuery`,
        },
        search_vercel_documentation_active: {
          id: `localConversation.mcpToolActivity.vercel.search_vercel_documentation.active`,
        },
        search_vercel_documentation_completed: {
          id: `localConversation.mcpToolActivity.vercel.search_vercel_documentation.completed`,
        },
        search_vercel_documentation_activeWithQuery: {
          id: `localConversation.mcpToolActivity.vercel.search_vercel_documentation.activeWithQuery`,
        },
        search_vercel_documentation_completedWithQuery: {
          id: `localConversation.mcpToolActivity.vercel.search_vercel_documentation.completedWithQuery`,
        },
        web_fetch_vercel_url_active: {
          id: `localConversation.mcpToolActivity.vercel.web_fetch_vercel_url.active`,
        },
        web_fetch_vercel_url_completed: {
          id: `localConversation.mcpToolActivity.vercel.web_fetch_vercel_url.completed`,
        },
        web_fetch_vercel_url_activeWithContext: {
          id: `localConversation.mcpToolActivity.vercel.web_fetch_vercel_url.activeWithContext`,
        },
        web_fetch_vercel_url_completedWithContext: {
          id: `localConversation.mcpToolActivity.vercel.web_fetch_vercel_url.completedWithContext`,
        },
      })));
  }))();
}
var _a, va, ya;
function ba() {
  return (ba = e(() => {
    (d(),
      c(),
      O(),
      (_a = `wallet`),
      (va = C({
        appRegistryKey: _a,
        toolArgumentsSchema: f({}).strip(),
        tools: {
          generate_cryptogram_from_saved_card: w(() => ({
            active: ya.generate_cryptogram_from_saved_card_active,
            completed: ya.generate_cryptogram_from_saved_card_completed,
          })),
          open_vgs_card_enrollment: w(() => ({
            active: ya.open_vgs_card_enrollment_active,
            completed: ya.open_vgs_card_enrollment_completed,
          })),
        },
      })),
      (ya = h({
        open_vgs_card_enrollment_active: {
          id: `localConversation.mcpToolActivity.wallet.open_vgs_card_enrollment.active`,
        },
        open_vgs_card_enrollment_completed: {
          id: `localConversation.mcpToolActivity.wallet.open_vgs_card_enrollment.completed`,
        },
        generate_cryptogram_from_saved_card_active: {
          id: `localConversation.mcpToolActivity.wallet.generate_cryptogram_from_saved_card.active`,
        },
        generate_cryptogram_from_saved_card_completed: {
          id: `localConversation.mcpToolActivity.wallet.generate_cryptogram_from_saved_card.completed`,
        },
      })));
  }))();
}

function initialize() {
  rn();
  xn();
  Ln();
  $n();
  dr();
  Mr();
  ui();
  Ni();
  Ii();
  ra();
  ga();
  ba();
}
let initialized = false;
function registries() {
  return {
    browser: nn,
    figma: yn,
    github: Fn,
    gmail: Zn,
    google_calendar: lr,
    google_drive: Ar,
    linear: li,
    linear_mcp_server: li,
    notion: ji,
    notion_mcp_server: ji,
    sites: Fi,
    slack: ta,
    vercel: ha,
    wallet: va,
  };
}
export function nativeMcpActivityDescriptor(
  app,
  tool,
  args,
  result,
  completed,
) {
  const names = [
    app.name,
    app.id,
    app.id.replace(/^connector[_-]/i, ""),
    ...(app.pluginDisplayNames ?? []),
  ].map((value) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_"),
  );
  const known = [
    "browser",
    "figma",
    "github",
    "gmail",
    "google_calendar",
    "google_drive",
    "linear",
    "linear_mcp_server",
    "notion",
    "notion_mcp_server",
    "sites",
    "slack",
    "vercel",
    "wallet",
  ];
  if (!names.some((name) => known.includes(name))) return null;
  if (!initialized) {
    initialize();
    initialized = true;
  }
  const all = registries();
  for (const name of names) {
    const registry = all[name];
    if (!registry) continue;
    const label = registry({
      matchingApp: app,
      toolKey: tool,
      toolArguments: args,
      toolResult: result,
      completed,
      intl: {
        formatMessage: (descriptor, values = {}) => ({ descriptor, values }),
      },
    });
    if (label) return label;
  }
  return null;
}
