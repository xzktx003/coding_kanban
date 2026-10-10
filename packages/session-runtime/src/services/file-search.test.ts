import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { searchFiles, scoreTerm } from "./file-search.js";

test("search honors nested ignore rules, exclusions and symlink boundaries while retaining hidden files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-ts-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of [".git", ".git/info", "src", "excluded", "cache"])
    await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, ".gitignore"), "cache/\n*.log\n");
  await writeFile(join(root, ".git/info/exclude"), "local.txt\n");
  await writeFile(join(root, "src/.gitignore"), "!keep.log\n");
  for (const name of [
    ".hidden.txt",
    "src/keep.log",
    "src/drop.log",
    "cache/hidden.txt",
    "excluded/no.txt",
    "local.txt",
    "src/Hello.ts",
  ])
    await writeFile(join(root, name), "fixture");
  await symlink(join(root, "src"), join(root, "linked"));
  const result = await searchFiles({
    root,
    query: "",
    excludeFolders: ["EXCLUDED"],
  });
  const paths = result.map((e) => e.path.slice(root.length + 1));
  assert.ok(paths.includes(".hidden.txt"));
  assert.ok(paths.includes("src/keep.log"));
  for (const hidden of [
    ".git",
    "src/drop.log",
    "cache",
    "cache/hidden.txt",
    "excluded",
    "local.txt",
    "linked",
  ])
    assert.ok(!paths.includes(hidden), hidden);
  assert.equal(
    (await searchFiles({ root, query: "", maxResults: 0 })).length,
    0,
  );
  assert.equal(
    (await searchFiles({ root, query: "", maxResults: 2 })).length,
    2,
  );
});

test("name search is substring-only; path search uses fuzzy terms with smart case and normalization", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-ts-search-name-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of [
    "Claude.ts",
    "CollabResumeEndEvent.ts",
    "café.md",
    "hello world.txt",
    "helper.ts",
  ])
    await writeFile(join(root, name), "fixture");
  assert.deepEqual(
    (await searchFiles({ root, query: "claude", namesOnly: true })).map(
      (e) => e.name,
    ),
    ["Claude.ts"],
  );
  assert.deepEqual(
    (await searchFiles({ root, query: "CAFE", namesOnly: true })).map(
      (e) => e.name,
    ),
    [],
  );
  assert.deepEqual(
    (await searchFiles({ root, query: "cafe", namesOnly: true })).map(
      (e) => e.name,
    ),
    ["café.md"],
  );
  assert.deepEqual(
    (await searchFiles({ root, query: "hlo wrd" })).map((e) => e.name),
    ["hello world.txt"],
  );
  await assert.rejects(
    searchFiles({ root, query: "", maxResults: -1 }),
    /maxResults/,
  );
});

// Expected rankings captured from the existing nucleo-matcher 0.3.1 Rust artifact.
const nucleoOracle = {
  names: [
    "FooBar.ts",
    "foobar.ts",
    "foo_bar.ts",
    "far-away-bar.ts",
    "a_foo_bar.ts",
    "afoobar.ts",
    "foo.ts",
    "x_foo.ts",
    "foofoo.ts",
    "café.ts",
    "cafe.ts",
    "caFé.ts",
    "łodz.ts",
    "lodz.ts",
    "Straße.ts",
    "Strasse.ts",
    "alphaBeta.ts",
    "a\tb.ts",
    "a b.ts",
    "a_b.ts",
    "café-cafe.ts",
    "z-fooBar.ts",
  ],
  fixtures: [
    {
      query: "fb",
      namesOnly: false,
      expected: [
        "foo_bar.ts",
        "FooBar.ts",
        "a_foo_bar.ts",
        "z-fooBar.ts",
        "far-away-bar.ts",
        "foobar.ts",
        "afoobar.ts",
      ],
    },
    {
      query: "foo",
      namesOnly: false,
      expected: [
        "FooBar.ts",
        "foo.ts",
        "foo_bar.ts",
        "foobar.ts",
        "foofoo.ts",
        "a_foo_bar.ts",
        "x_foo.ts",
        "z-fooBar.ts",
        "afoobar.ts",
      ],
    },
    {
      query: "f",
      namesOnly: false,
      expected: [
        "FooBar.ts",
        "far-away-bar.ts",
        "foo.ts",
        "foo_bar.ts",
        "foobar.ts",
        "foofoo.ts",
        "a_foo_bar.ts",
        "x_foo.ts",
        "z-fooBar.ts",
        "caFé.ts",
        "afoobar.ts",
        "cafe.ts",
        "café-cafe.ts",
        "café.ts",
      ],
    },
    {
      query: "cafe",
      namesOnly: false,
      expected: ["caFé.ts", "cafe.ts", "café-cafe.ts", "café.ts"],
    },
    {
      query: "lodz",
      namesOnly: false,
      expected: ["lodz.ts", "łodz.ts"],
    },
    {
      query: "stras",
      namesOnly: false,
      expected: ["Strasse.ts", "Straße.ts"],
    },
    {
      query: "ab",
      namesOnly: false,
      expected: [
        "a\tb.ts",
        "a b.ts",
        "a_b.ts",
        "a_foo_bar.ts",
        "far-away-bar.ts",
        "alphaBeta.ts",
        "afoobar.ts",
      ],
    },
    {
      query: "a\tb",
      namesOnly: false,
      expected: ["a\tb.ts"],
    },
    {
      query: "foo",
      namesOnly: true,
      expected: [
        "FooBar.ts",
        "foo.ts",
        "foo_bar.ts",
        "foobar.ts",
        "foofoo.ts",
        "a_foo_bar.ts",
        "x_foo.ts",
        "z-fooBar.ts",
        "afoobar.ts",
      ],
    },
    {
      query: "cafe",
      namesOnly: true,
      expected: ["caFé.ts", "cafe.ts", "café-cafe.ts", "café.ts"],
    },
    {
      query: "lodz",
      namesOnly: true,
      expected: ["lodz.ts", "łodz.ts"],
    },
    {
      query: "a\tb",
      namesOnly: true,
      expected: ["a\tb.ts"],
    },
    {
      query: "é",
      namesOnly: true,
      expected: ["caFé.ts", "café-cafe.ts", "café.ts"],
    },
    {
      query: "f",
      namesOnly: true,
      expected: [
        "FooBar.ts",
        "far-away-bar.ts",
        "foo.ts",
        "foo_bar.ts",
        "foobar.ts",
        "foofoo.ts",
        "a_foo_bar.ts",
        "x_foo.ts",
        "z-fooBar.ts",
        "caFé.ts",
        "afoobar.ts",
        "cafe.ts",
        "café-cafe.ts",
        "café.ts",
      ],
    },
  ],
};

test("search order matches native Nucleo oracle for boundaries, Unicode and literal whitespace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-search-oracle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of nucleoOracle.names)
    await writeFile(join(root, name), "fixture");
  for (const fixture of nucleoOracle.fixtures)
    assert.deepEqual(
      (await searchFiles({ root, ...fixture })).map((entry) => entry.name),
      fixture.expected,
      `${fixture.namesOnly ? "name" : "path"}: ${JSON.stringify(fixture.query)}`,
    );
});

test("ignore precedence and global/common-dir rules follow linked worktrees", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "kanban-search-ignore-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "repo"),
    home = join(base, "home"),
    wt = join(base, "linked");
  await mkdir(root);
  await mkdir(home);
  await mkdir(join(root, "nested"));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  await writeFile(join(root, "tracked"), "fixture");
  git("add", ".");
  git("commit", "-m", "initial");
  await writeFile(join(base, ".ignore"), "parent-hidden.txt\n");
  await writeFile(join(root, ".ignore"), "*.skip\n");
  await writeFile(join(root, "nested", ".gitignore"), "!keep.skip\n");
  await writeFile(join(root, "nested", "keep.skip"), "hidden");
  await writeFile(join(root, "parent-hidden.txt"), "hidden");
  await writeFile(join(home, "global-ignore"), "global-hidden.txt\n");
  git("config", "--global", "core.excludesFile", join(home, "global-ignore"));
  await writeFile(join(root, ".git", "info", "exclude"), "common-hidden.txt\n");
  git("worktree", "add", "--detach", wt);
  for (const name of ["global-hidden.txt", "common-hidden.txt"])
    await writeFile(join(wt, name), "hidden");
  assert.ok(
    !(await searchFiles({ root, query: "", env })).some(
      (entry) =>
        entry.name === "keep.skip" || entry.name === "parent-hidden.txt",
    ),
  );
  const found = await searchFiles({ root: wt, query: "", env });
  assert.ok(
    !found.some(
      (entry) =>
        entry.name === "global-hidden.txt" ||
        entry.name === "common-hidden.txt",
    ),
  );
  assert.ok(found.some((entry) => entry.name === "tracked"));
});

// 6,400 native score results generated with the pinned Rust rlib; corpus seed 731.
const scoreCorpus = [
  "øσ🙂🙂a",
  "cß2CσCßc🙂a-σBΣ_øσ",
  "ß.σ1C-b2bB/",
  "łł1c",
  "éςłbCéłCCA🙂🙂1",
  "__.__øΣ.ΣCaß🙂łł🙂",
  "cø/ééß-.CςcC1łßß",
  "-.B🙂é",
  "🙂BøBcσA-ßςé/1..ß.σAøC/🙂c2",
  "ΣøcCΣøΣbb-łł",
  "cøa🙂1cCΣ/1/ø22🙂bAéb",
  "_ß-c1ςø.🙂B2🙂1éøC",
  "ACς_a🙂ςCΣ..CAςCΣ1ςß2σß",
  "éø🙂Σé/ςø/",
  "Cßb-C2éłς22c.Σ-//éA🙂_Caéł",
  "b-ßΣ1ςBé2łBbß1ßłAé",
  "aBßb./-øB_b2",
  "Σaςc",
  "B🙂2bB/ßCéc2/aσbłς-øςςc",
  "øłςbσ-1A_øłBøBςłbB2/BΣ",
  "bbςA1-",
  "/łé_øς_2Ac🙂ßßCéσcbbé/2a/Σ",
  "b.øb🙂Bbbσø/ς/1A",
  "ςł1cøςßb🙂aΣ/a_1🙂1σ-/Cσ_Aς",
  "Cσ2",
  "AAΣcøł--🙂C_cb",
  "ßΣø.σς.ςłAc-ł/cßb/Cσ2σøςł",
  "øA🙂øéøCσ_c🙂a.",
  "c2.c🙂ςΣ-1_σσøøB",
  "é🙂_ß/øßc",
  ".2_--łłø_σΣA.C1/cςς1/AaA",
  "cCéςc_Σø-éøabßς",
  "_B2C_é2/ßσ🙂1B🙂Cł-c_c_σ",
  "cł2ß🙂é🙂AAΣcaAø🙂σłéσ",
  "ςøA1ßB/ccßσøAłé_ł-1/cc2",
  "Σ1a/🙂Aς-1/ςBΣCaé",
  "ß_🙂é.B/a🙂A1._ςbc🙂σ/",
  "1A1b-_cA_σcςςßBσC",
  "1ςbø...--bC/aς_é/",
  ".🙂ßCa_ßCbßéΣσa/.ø.",
  "/Σ_aςłσΣ2ςΣbła",
  "øa/bcø-łłB1Cß",
  "🙂_éBσcø..-",
  "Σa.a.b-Cςø",
  "ø🙂_-błCß_CAAσł-b🙂σ1aAc",
  "c_a.BAΣCς//2Cßa",
  "ςcb",
  "aøb/c.ø-éσ2ςééς.ßσ._ςσé2",
  "øσa1/_Σ.1Aςé",
  "1ςςßC-/🙂b/σ1B",
  "cσΣłłςøa/acł-éΣBa",
  "ø2CA/.cB1-🙂",
  "éøc🙂ς",
  "σΣøA/ς2éccł1CBσł2øςB-ab_",
  "C2Acł",
  "-1ßaς1ς/øCbσς",
  "ø_ς",
  "øß_éab1ςa12C",
  "Σ.BaCé..🙂a.2é",
  "2.ø1/Σé-aBøł1ał_A.",
  "ß.1cłßA",
  "CßłB/",
  "/cΣ🙂ccBß2cσ-Σb.ςAłł/🙂_/",
  "🙂ßB-/łAcébCbaς2B1Aaß",
  "2🙂./1A",
  "2_AéßΣłAσéøłłσ-σc",
  "🙂éAø🙂-øøß-_baø-🙂BC_",
  "ςABłΣ.CC/ßéCCAbσCa.a",
  "22ςłΣAłAc1ßσ..ab",
  "BAbCC2-bC_",
  "-Bc/Σø",
  "2øabςcé2øCéσc--.Σ",
  "σ2_Σσß.aA/b2AłC_CłbΣcaa-Σ",
  "cςéΣaøc1_.ø.",
  "-2/ςøςał/.1b/A",
  "-cσ.",
  "B2_Bςc1BcΣcσ",
  "ø_ßσΣ🙂1.é1.1.a_bøbA",
  "-ΣAA_1ς",
  "aaAσłσaAc_łBBΣłAσłcß-é",
  "_Bb/ΣéΣAΣ_ΣBΣB.łb.ςß-øA",
  "Σ_ςσ.é_Bßσς_bbé",
  "aBßa1σc1Bøσ1CøéBø.ß🙂B-Bø",
  "/ßła1ł🙂AA1",
  "Cßł🙂._B2b/-a",
  "σ-ΣcBbΣ2.ac./2éBσłς-ΣA",
  "-B/ςcßbé.ø.ß/ςCßΣΣß/éC_.2",
  "øcσσΣB",
  "AςAøac.2éßßb2łøσ🙂/",
  "AA_2a/-cøC",
  "C-_🙂_",
  "éłbaøςbcB/ςłłß-AΣ_acΣéBCa",
  "Bςßéc_cø/",
  ".σßø🙂a1cAéøß🙂ø1.CøC",
  "ß2ΣΣł.ßAé",
  "Bσ1béA2σßßøcAσAé🙂σał-2ςc",
  "ΣcAø-caΣb_ΣA_",
  "-aAA🙂🙂1b🙂σłBCB",
  "éσCσ_aAΣéłał2øßB2-øßbéß",
  "ßAéA",
  "-céσß1Σ2é🙂B-σBbBb1",
  "2-ς🙂-2ςΣc_Aςb2-CBéc.CłBCé",
  "bBł_CcCbßéB-🙂c1CAσłabßBc",
  "2øéΣ-ς🙂🙂σø1.éb",
  "-__1łßa",
  "-c🙂øbB-éςéł1",
  "bbøB.c_Aé_-B/ΣAA/AC1ς1B1",
  "/a🙂/ςłø2_ςAΣ1",
  "ßłΣb🙂1ß2abΣłΣςΣcςła🙂c",
  "-/Σ1..Σ🙂øß.1BΣc-//",
  "a1B1-σéß2b2A🙂B1ł",
  "Σ_._Σ-_é/🙂ΣAσ1-A",
  "bB🙂1_øCΣ.ø1øC-ßa--A-/_é-.",
  "ałAc22_Σß.2ABøσßéσccaAσ🙂C",
  "aCΣabøς_ø-Σ_ςΣΣC",
  "Aß-/Σc.ς2Σ🙂12-B",
  "🙂ςac.🙂bßΣςC1ø/cb_łcb1σ",
  "//2σB.BABc_1σa🙂-éaøΣ2/ß",
  "σé🙂2🙂é🙂Σ.B_ς21",
  "Σ2ba.🙂σbßß1Abøc1ςC",
  "./ΣłßΣß-/σøaσø1ab",
  "bςC2ø🙂ccaBłς🙂",
  "ł2σßΣBbΣ-øcC1ς_ς.b2🙂Cßß",
  "σσßςłς",
  "/CøøCΣ/.1",
  "cøΣßB-øéaσσbA",
  "øς/-AςBaBς/-ΣC",
  "øøßßø_-🙂11.🙂Ał2A🙂",
  "ał2CccΣB🙂1a/σ1a1Σł",
  "2a🙂Σ//-ςcc",
  "cé🙂a_/CΣł",
  ".c1BAłAAéC_aB-2ςé-_.ł/",
  "ς_ς1łøςBCł_-ςCςς2ςΣ_",
  "ΣC/σσACbσA-ς2🙂.σ_2.2a/",
  "σ/🙂_1σAb🙂CłaéB.//ςł2Cb",
  "🙂ß1ςøøBba_éłaBσσ/",
  "1c22_-1ß🙂σła1-111bßΣaB",
  "2ł-B",
  "CCłςbΣø🙂Σ_ł11Bbς1",
  "_Σ_aøé2ς-éaσσσøςςøéC-1",
  "éAa-cA/",
  "σAabé1",
  "-C.ςΣø-ø1ςCABßA",
  "cBBaA.cAłςł-1éA_/øς1cßéb🙂",
  "ςa.c-Ałéa2ł.",
  "łςΣ.éσ2AéacBΣø.aΣσ",
  "-a🙂🙂a_ßł/ł-σcøA🙂Σ_🙂/Σ.Bé",
  "ß/øbς_øσΣca.øłb_σ",
  "ł__B./Σbσςa_c-Aa/baBßAc",
  "łBéC-CacaBΣb",
  "aø-c_1bc.ς_éc/łé/_σςbø1",
  "1a2/ßB1/łłßøσBc_/é.🙂A🙂σΣł",
  "ß_Bé",
  "bß🙂B.σΣ",
  "--ς",
  "łBcb2ßΣACΣ",
  "ß-_🙂.aø",
  ".ł_a_b.cé1-ø.øc_",
  "ø1/Cςéb/A🙂ςa_.Aς",
  "øBßéςé/c/ς1",
  "ΣΣΣłς/éΣς🙂ςøςςBła.-BBσb-",
  "_/øé_2BcA.łcB/σ🙂🙂",
  "łσC.2a_--Bccøßc_cΣ1ςaBøΣ",
  "2B🙂Σ_bςΣC.bCß-B",
  "/.BBłCς2éøς",
  "-_🙂.c_🙂aA12c2Σ21Cσ",
  "-1aAaσé🙂🙂",
  "błςøB-σ11C2ab.2B/ΣB/1C",
  "Σbłø🙂C-Aσ",
  "1øBΣCéa1_A--bAΣbbbAø🙂aΣ",
  "/2cς.cc./CC.Σ-Ałb_1C1ßB-ς",
  "ł-aΣ._é-",
  "1øł1AΣΣC🙂øC_🙂b/éΣ",
  "bAé2ł_",
  "A.ø🙂ß_",
  "éßł-øł_ccéC2C/σßCς🙂2",
  "ςΣCCé-2ø2AøA🙂σcł2ςCC-",
  "Σ-1é_",
  "b/2Σé_--AA/σ/Σ",
  "ς-/",
  "σΣ_.🙂ø🙂-ßłσłC",
  "2øCςø2σ2éABBσΣAa./",
  "C/.b2CcσAø-Cß/.ßσßAøA",
  "A2/σ🙂a🙂bß_-/_.A.ßCΣΣ",
  "//σ1-_.c",
  ".1C2aςb",
  "/aaa-🙂bbß_ł_-é2ø",
  "-ß.ébc.2AΣςς",
  "ςAłC/ς_",
  "cσ/2..aΣłA🙂ł2🙂",
  "σ_BaςςøCς1.Σcł",
  ".cC-12a..BaςΣ2AéłB",
  "σΣ1Σ🙂1/A2.CB/2ø_",
  ".c..ς22Σ_Σ/łBa/b/-.1🙂",
  "aa2ς1c.1béC-ßb",
  "bc-",
  "øa/bABb_ß/c-_σacßc/b",
  "łłς🙂a-σabßßbc.BΣ🙂",
  "_1-C-2B/12_ø",
  "-CCø🙂aΣaBłé🙂🙂b/éø",
];
const scoreDigests = [
  {
    query: "a",
    names: false,
    sha256: "8bf438ee16b039e7be4bd911033204a028166f036af126e8e32441fa13b0aea6",
  },
  {
    query: "ab",
    names: false,
    sha256: "beb8ffefedd9f9f75adde20fb98857c544f0952693326b37329e391a76876f3c",
  },
  {
    query: "abc",
    names: false,
    sha256: "c09cfb8ce4f6e0f085d6021bcba50a2ee24215e7865026b9a23bb0b31e5af5f2",
  },
  {
    query: "A",
    names: false,
    sha256: "76b75d2c01fdf0feac2b4482f2e392cad844c604d14e31c27efb95785fcd24c4",
  },
  {
    query: "1",
    names: false,
    sha256: "1aec23455731482ceb895b2651d9701ff2db2dfd68b98ab28cc05b88eee98db8",
  },
  {
    query: "12",
    names: false,
    sha256: "c670586a3533991c0c137ff7ff1d79cc9200c075f6c58b78f3312d672b167120",
  },
  {
    query: "é",
    names: false,
    sha256: "6d3ff0794ccc12980112ceb00119e9c0b07a4cb9057cd32a665343f7a7ee0fa4",
  },
  {
    query: "e",
    names: false,
    sha256: "6d3ff0794ccc12980112ceb00119e9c0b07a4cb9057cd32a665343f7a7ee0fa4",
  },
  {
    query: "l",
    names: false,
    sha256: "36014ad4dcc7e12937939d892e698174bef421eea3e84c2973fc4136ddf5bdaa",
  },
  {
    query: "s",
    names: false,
    sha256: "728f510b7059dd5cc348d74a89464dd7abb84bf6e65484e0fb911e2a6dca01b0",
  },
  {
    query: "σ",
    names: false,
    sha256: "454d497c6c4f2891bbd1b90a2d63b757206185de0085cc017fb3538fb7b5d93e",
  },
  {
    query: "ø",
    names: false,
    sha256: "14f601a9be8af3d41b2bd1acb95bf8cd3b960da67fa7ed33ff27a2fe9f888dce",
  },
  {
    query: "🙂",
    names: false,
    sha256: "ff437ea271110e35b3c068caf3840dc72a130c428b60719fcdc23f5397f24526",
  },
  {
    query: "-",
    names: false,
    sha256: "b81cac6375ef49cfff793002f554548cf55c742937d467291ee7b90f51002ce6",
  },
  {
    query: ".a",
    names: false,
    sha256: "58221c082c877958422840e8d109322a316517ad93dfaf5f83c97a58a12d011d",
  },
  {
    query: "a_b",
    names: false,
    sha256: "0f944e588b58b74e5bc6362d368b539d47089c60fdbf73e9d87d6bb677ebfd11",
  },
  {
    query: "a",
    names: true,
    sha256: "8fb1a366704a1c119d2019e93e893841fe7742ec99521eb0b158f2bebd860ec0",
  },
  {
    query: "ab",
    names: true,
    sha256: "77ee4cd839b647ff317b758e223365d2e1864a95749510cd36f117e58cf4debf",
  },
  {
    query: "abc",
    names: true,
    sha256: "8e1a1098faee7c804743d9347df964f66d8e536ec920aae79dcf3862c640d714",
  },
  {
    query: "A",
    names: true,
    sha256: "05f0ff63a602b9f44f843ad6b05fd4c25692a9b2a51187db17c1b129cf2f727e",
  },
  {
    query: "1",
    names: true,
    sha256: "7c9d05b2df4d3ec79823a25b5f76172f4ff71123e73e40e5a0402eb0cc9ac6c1",
  },
  {
    query: "12",
    names: true,
    sha256: "496961d082dd230e80098e29b91c5b0a34d33c182c0112fbe3821cc2116ce194",
  },
  {
    query: "é",
    names: true,
    sha256: "1aaceac91e328a97a9d8112d64253bbf1db669770fd6f5a65164ade9862c9f31",
  },
  {
    query: "e",
    names: true,
    sha256: "1aaceac91e328a97a9d8112d64253bbf1db669770fd6f5a65164ade9862c9f31",
  },
  {
    query: "l",
    names: true,
    sha256: "83f10da5d220d96205a2f27728127dfa467270a0682f031d03c0de2120876512",
  },
  {
    query: "s",
    names: true,
    sha256: "8647da88cfc656665066825c035ced383bc900653de009d2c3f7d5b3946b49e7",
  },
  {
    query: "σ",
    names: true,
    sha256: "8f14cd846cc54fd94a1ed98b468b9fea7e92d7c0c5064f36b5c3926cfba8284c",
  },
  {
    query: "ø",
    names: true,
    sha256: "eccd7cc096145d28746ff355b4e6c421069f1799bf83fdf00cfbeafbc3a7448e",
  },
  {
    query: "🙂",
    names: true,
    sha256: "ff437ea271110e35b3c068caf3840dc72a130c428b60719fcdc23f5397f24526",
  },
  {
    query: "-",
    names: true,
    sha256: "b81cac6375ef49cfff793002f554548cf55c742937d467291ee7b90f51002ce6",
  },
  {
    query: ".a",
    names: true,
    sha256: "f63ae8e661d3a051999dbb7fe72b5559703b5db78c7fe81cbf5b0bc64af484b9",
  },
  {
    query: "a_b",
    names: true,
    sha256: "99021279031165fdf52d097d4eacccd3858cdf6e096d8b2034c0d281bf8ce93a",
  },
];
test("Nucleo 0.3.1 differential corpus preserves all 6400 scores", () => {
  for (const check of scoreDigests) {
    const scores = scoreCorpus.map(
      (source) => scoreTerm(source, check.query, check.names) ?? null,
    );
    assert.equal(
      createHash("sha256").update(JSON.stringify(scores)).digest("hex"),
      check.sha256,
      JSON.stringify(check),
    );
  }
});

test("nested repositories establish their own Git ignore boundary under arbitrary search roots", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-nested-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "outer", ".git"), { recursive: true });
  await mkdir(join(root, "outer", "inner", ".git"), { recursive: true });
  await writeFile(join(root, "outer", ".gitignore"), "inner-visible.txt\n");
  await writeFile(join(root, "outer", "inner", ".gitignore"), "hidden.log\n");
  await writeFile(join(root, "outer", "inner", "hidden.log"), "hidden");
  await writeFile(join(root, "outer", "inner", "inner-visible.txt"), "visible");
  const found = await searchFiles({ root, query: "" });
  assert.ok(found.some((entry) => entry.name === "inner-visible.txt"));
  assert.ok(!found.some((entry) => entry.name === "hidden.log"));
});

test("long path matching follows the native bounded-matrix greedy fallback", () => {
  const needle = "ab".repeat(40);
  // Captured from the Rust oracle immediately below and above its 100 KiB cell threshold.
  assert.equal(scoreTerm("a_b_".repeat(200) + needle, needle, false), 1928);
  assert.equal(scoreTerm("a_b_".repeat(400) + needle, needle, false), 1693);
  assert.equal(scoreTerm("a_b_".repeat(800) + needle, needle, false), 1693);
});

test("ignore patterns remain case-sensitive even though excluded folder names are not", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-case-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".ignore"), "hidden.txt\n");
  await writeFile(join(root, "hidden.txt"), "hidden");
  await writeFile(join(root, "Hidden.txt"), "visible");
  const found = await searchFiles({ root, query: "" });
  assert.ok(found.some((entry) => entry.name === "Hidden.txt"));
  assert.ok(!found.some((entry) => entry.name === "hidden.txt"));
});

test("a nonempty space-only pattern uses native case-sensitive tie order", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-space-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "Z.ts"), "z");
  await writeFile(join(root, "a.ts"), "a");
  assert.deepEqual(
    (await searchFiles({ root, query: " " })).map((entry) => entry.name),
    ["Z.ts", "a.ts"],
  );
  assert.deepEqual(
    (await searchFiles({ root, query: "" })).map((entry) => entry.name),
    ["a.ts", "Z.ts"],
  );
});
