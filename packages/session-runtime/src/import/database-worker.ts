import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

const tables = [
  "bots",
  "acp_sessions",
  "acp_session_updates",
  "automation_runs",
  "automation_run_projects",
  "automation_run_steps",
  "notes",
] as const;
const request = workerData as {
  sourcePath: string;
  targetPath?: string;
  cancel: SharedArrayBuffer;
};
const cancelled = new Int32Array(request.cancel);
function check() {
  if (Atomics.load(cancelled, 0) !== 0) throw new Error("IMPORT_CANCELLED");
}
function hasTable(db: Database.Database, table: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table),
  );
}
function columns(db: Database.Database, table: string) {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((c) => c.name);
}
function run() {
  check();
  if (!existsSync(request.sourcePath))
    return request.targetPath
      ? 0
      : Object.fromEntries(tables.map((t) => [t, 0]));
  const source = new Database(request.sourcePath, {
    readonly: true,
    fileMustExist: true,
  });
  let target: Database.Database | undefined;
  try {
    source.pragma("busy_timeout=5000");
    source.pragma("temp_store=FILE");
    source.pragma("cache_size=-4096");
    source.exec("BEGIN");
    if (!request.targetPath) {
      const result: Record<string, number> = {};
      for (const table of tables) {
        check();
        result[table] = hasTable(source, table)
          ? (
              source.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
                n: number;
              }
            ).n
          : 0;
      }
      return result;
    }
    target = new Database(request.targetPath, { fileMustExist: true });
    target.pragma("busy_timeout=5000");
    target.pragma("journal_mode=WAL");
    target.pragma("temp_store=FILE");
    target.pragma("cache_size=-4096");
    const destination = target;
    return destination
      .transaction(() => {
        parentPort!.postMessage({ started: true });
        let inserted = 0;
        for (const table of tables) {
          check();
          if (!hasTable(source, table) || !hasTable(destination, table))
            continue;
          const available = columns(source, table),
            appendOnly =
              table === "acp_session_updates" ||
              table === "automation_run_steps";
          const common = columns(destination, table).filter(
            (c) => available.includes(c) && !(appendOnly && c === "id"),
          );
          if (!common.length || common.some((c) => !/^\w+$/.test(c)))
            throw new Error("IMPORT_SCHEMA");
          if (
            table === "acp_session_updates" &&
            ["session_id", "payload", "created_at"].some(
              (c) => !common.includes(c),
            )
          )
            throw new Error("IMPORT_SCHEMA");
          const names = common.map((c) => `"${c}"`).join(",");
          const put = destination.prepare(
            `INSERT INTO ${table}(${names}) VALUES(${common.map(() => "?").join(",")}) ON CONFLICT DO NOTHING`,
          );
          // Keep multiset deduplication inside SQLite's disk-backed temporary tables.
          // Repeated identical native events are retained, and neither thread keeps a
          // JavaScript map containing the full transcript. The index also avoids O(n²)
          // scans when importing a long conversation into an empty destination.
          if (appendOnly) {
            destination.exec(
              `CREATE TEMP TABLE import_counts AS SELECT ${names},count(*) AS occurrence_count FROM ${table} GROUP BY ${names}; CREATE INDEX import_counts_lookup ON import_counts(${names})`,
            );
          }
          const count = appendOnly
            ? destination.prepare(
                `SELECT occurrence_count AS n FROM import_counts WHERE ${common.map((c) => `"${c}" IS ?`).join(" AND ")}`,
              )
            : undefined;
          for (const value of source
            .prepare(
              `SELECT ${names}${appendOnly ? `,row_number() OVER(PARTITION BY ${names} ORDER BY id) AS __source_occurrence` : ""} FROM ${table}${appendOnly ? " ORDER BY id ASC" : ""}`,
            )
            .iterate()) {
            check();
            const row = value as Record<string, unknown>,
              values = common.map((c) => row[c]);
            if (count) {
              const previous =
                (count.get(...values) as { n: number } | undefined)?.n ?? 0;
              if (Number(row.__source_occurrence) <= previous) continue;
            }
            inserted += put.run(...values).changes;
          }
          if (appendOnly) destination.exec("DROP TABLE import_counts");
        }
        check();
        return inserted;
      })
      .immediate();
  } finally {
    try {
      target?.close();
    } finally {
      source.close();
    }
  }
}
try {
  const value = run();
  parentPort!.postMessage({ value });
} catch (error) {
  const code = error as { code?: string; message?: string };
  const message =
    code.message === "IMPORT_CANCELLED"
      ? "Import cancelled"
      : code.message === "IMPORT_SCHEMA"
        ? "Unsupported import database schema"
        : code.code === "SQLITE_BUSY"
          ? "Import database is busy; retry after current work completes"
          : "Import database transaction failed";
  parentPort!.postMessage({ error: message });
} finally {
  parentPort!.close();
}
