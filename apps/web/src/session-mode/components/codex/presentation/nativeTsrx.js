// TSRX grammar from the user-provided openai.chatgpt 26.51002.51308 VSIX.
// Source: highlight-code-7c4c2ef3d4d8.js, Pt; the grammar body is unchanged.
// Only the original bundled TypeScript grammar import is resolved via the
// exactly matching highlight.js 11.11.1 dependency.
import typescript from "highlight.js/lib/languages/typescript";
const Mt = {
  scope: "keyword",
  match: /@\{|@(?:if|else|for|empty|switch|case|default|try|pending|catch)\b/,
  relevance: 0,
};
const Nt = 4096;
const nativeTsrx = (e) => {
  let t = typescript(e),
    n = {
      begin: /\{/,
      end: /\}/,
      keywords: t.keywords,
      contains: [`self`, ...t.contains],
      relevance: 0,
    },
    r = {
      begin: /(?<=<[A-Za-z][\w.:-]*)(?=[\s/>])/,
      end: /\/?>/,
      scope: `tag`,
      relevance: 0,
      contains: [
        n,
        { scope: `attr`, match: /[A-Za-z_$][\w$:.-]*/, relevance: 0 },
        e.APOS_STRING_MODE,
        e.QUOTE_STRING_MODE,
      ],
    },
    i = {
      begin: [/<(?=[A-Za-z])/, /[A-Za-z][\w.:-]*(?=[\s/>])/],
      beginScope: { 1: `tag`, 2: `name` },
      end: /\/>/,
      endScope: `tag`,
      relevance: 0,
      "on:begin": (e, t) => {
        let n = e.input ?? ``,
          r = 0,
          i = ``,
          a = (e.index ?? 0) + e[0].length,
          o = Math.min(n.length, a + Nt);
        for (let e = a; e < o; e++) {
          let a = n[e];
          if (i) a === `\\` ? e++ : a === i && (i = ``);
          else if (a === `"` || a === `'` || a === "`") i = a;
          else if (a === `{`) r++;
          else if (a === `}` && r > 0) r--;
          else if (a === `>` && r === 0) {
            n[e - 1] !== `/` && t.ignoreMatch();
            return;
          }
        }
        t.ignoreMatch();
      },
      contains: [{ ...r, begin: /(?<=<[A-Za-z][\w.:-]*)\s+/, end: /(?=\/>)/ }],
    },
    a = {
      begin: /<>/,
      end: /<\/>/,
      beginScope: `tag`,
      endScope: `tag`,
      relevance: 0,
      contains: [],
    },
    o = {
      begin: [/<(?=[A-Za-z])/, /[A-Za-z][\w.:-]*(?=[\s/>])/],
      beginScope: { 1: `tag`, 2: `name` },
      end: [/<\/(?=[A-Za-z])/, /[A-Za-z][\w.:-]*/, /\s*>/],
      endScope: { 1: `tag`, 2: `name`, 3: `tag` },
      "on:begin": (e, t) => {
        /[\w$]/.test(e.input?.[(e.index ?? 0) - 1] ?? ``) && t.ignoreMatch();
      },
      relevance: 0,
      contains: [],
    },
    s = { ...o, "on:begin": void 0, contains: [] },
    c = [
      Mt,
      {
        begin: [/<(?=style[\s>])/, /style(?=[\s>])/],
        beginScope: { 1: `tag`, 2: `name` },
        end: [/<\/(?=style\s*>)/, /style/, /\s*>/],
        endScope: { 1: `tag`, 2: `name`, 3: `tag` },
        contains: [
          r,
          {
            begin: /(?<=>)(?!<\/style\s*>)/,
            end: /(?=<\/style\s*>)/,
            subLanguage: `css`,
            relevance: 0,
          },
        ],
        relevance: 0,
      },
      i,
      a,
      o,
      n,
    ],
    l = c.map((e) => (e === o ? s : e));
  ((o.contains = [r, ...l]),
    (s.contains = o.contains),
    (a.contains = l),
    (n.contains = [`self`, ...c.filter((e) => e !== n), ...t.contains]));
  let u = t.contains.map((e) =>
    e.contains?.some((e) => typeof e != `string` && e.subLanguage === `xml`)
      ? { ...e, contains: [...c, ...e.contains] }
      : e,
  );
  return {
    ...t,
    name: `TSRX`,
    aliases: [],
    disableAutodetect: !0,
    contains: [...c, ...u],
  };
};
export default nativeTsrx;
