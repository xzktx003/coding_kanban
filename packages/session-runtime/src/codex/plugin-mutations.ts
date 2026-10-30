import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { JsonStore } from "../core/json-store.js";
import { KeyedSerial } from "../core/serial.js";
import {
  HttpError,
  isObject,
  object,
  type Json,
  type JsonObject,
} from "../core/json.js";

export type PluginTarget = {
  marketplacePath: string | null;
  remoteMarketplaceName: string | null;
  pluginName: string;
};
type Saved = {
  operationId: string;
  namespace: string;
  target: PluginTarget;
  operation: "install" | "uninstall";
  status: "unknown" | "accepted" | "state-confirmed" | "rejected";
  at: number;
};
type Detail = JsonObject & { summary: JsonObject };
type Result = {
  operationId: string;
  sourceOperationId?: string;
  operation?: Saved["operation"];
  status: Saved["status"];
  appsNeedingAuth: JsonObject[];
  authPolicy?: Json;
  plugin?: Detail;
  error?: string;
};
const text = (value: unknown, max = 512): value is string =>
  typeof value === "string" &&
  !!value &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);
const key = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function parseTarget(value: unknown): PluginTarget {
  if (
    !isObject(value) ||
    Object.keys(value).some(
      (field) =>
        !["marketplacePath", "remoteMarketplaceName", "pluginName"].includes(
          field,
        ),
    ) ||
    !text(value.pluginName)
  )
    throw new HttpError(400, "Invalid plugin target");
  const marketplacePath = value.marketplacePath ?? null,
    remoteMarketplaceName = value.remoteMarketplaceName ?? null;
  if (
    (marketplacePath !== null &&
      (!text(marketplacePath, 4096) || !isAbsolute(marketplacePath))) ||
    (remoteMarketplaceName !== null && !text(remoteMarketplaceName)) ||
    Number(marketplacePath !== null) +
      Number(remoteMarketplaceName !== null) !==
      1
  )
    throw new HttpError(400, "A plugin requires one exact marketplace source");
  return {
    marketplacePath: marketplacePath as string | null,
    remoteMarketplaceName: remoteMarketplaceName as string | null,
    pluginName: value.pluginName,
  };
}
/** Local durable duplicate suppression. It is not a cross-client native CAS. */
export class PluginMutations {
  private store: JsonStore;
  private serial = new KeyedSerial();
  private pending = 0;
  constructor(
    private options: {
      home: string;
      context: () => Promise<{ scope: string; namespace: string }>;
      current: (scope: string) => boolean;
      call: (
        method: string,
        params: Json,
        scope: string,
        beforeSend?: () => void,
      ) => Promise<Json>;
    },
  ) {
    this.store = new JsonStore(
      join(options.home, ".codexia", "plugin-mutations-v1.json"),
      () => ({ version: 1, rows: [] }),
    );
  }
  private assert(scope: string) {
    if (!this.options.current(scope))
      throw new HttpError(
        409,
        "NOT_SENT: plugin account or runtime scope changed",
      );
  }
  private rows(value: JsonObject): Saved[] {
    if (
      value.version !== 1 ||
      !Array.isArray(value.rows) ||
      value.rows.length > 200
    )
      throw new HttpError(409, "Plugin mutation receipts require inspection");
    return value.rows.map((value) => {
      const row = value as unknown as Saved;
      if (
        !row ||
        !text(row.operationId, 128) ||
        !text(row.namespace) ||
        !["install", "uninstall"].includes(row.operation) ||
        !["unknown", "accepted", "state-confirmed", "rejected"].includes(
          row.status,
        ) ||
        !Number.isSafeInteger(row.at) ||
        row.at < 0
      )
        throw new HttpError(409, "Invalid plugin mutation receipt");
      parseTarget(row.target);
      return row;
    });
  }
  private async read() {
    try {
      if ((await stat(this.store.path)).size > 2 * 1024 * 1024)
        throw new HttpError(413, "Plugin receipt budget exceeded");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return this.rows(await this.store.read());
  }
  private async save(row: Saved) {
    await this.store.update((value) => {
      const rows = this.rows(value).filter(
        (value) =>
          !(
            value.namespace === row.namespace &&
            value.operationId === row.operationId
          ),
      );
      if (
        row.status === "unknown" &&
        rows.filter((value) => value.status === "unknown").length >= 100
      )
        throw new HttpError(
          429,
          "Inspect existing plugin receipts before another change",
        );
      const unknown = rows.filter((value) => value.status === "unknown"),
        settled = rows
          .filter((value) => value.status !== "unknown")
          .slice(-Math.max(0, 99 - Number(row.status !== "unknown")));
      return {
        version: 1,
        rows: [...unknown, ...settled, row] as unknown as Json[],
      };
    });
  }
  private async detail(target: PluginTarget, scope: string): Promise<Detail> {
    this.assert(scope);
    const response = object(
      await this.options.call("plugin/read", target, scope),
    );
    this.assert(scope);
    if (Buffer.byteLength(JSON.stringify(response)) > 2 * 1024 * 1024)
      throw new HttpError(413, "Plugin detail exceeds its read budget");
    const plugin = object(response.plugin),
      summary = object(plugin.summary);
    if (
      !text(summary.id) ||
      typeof summary.installed !== "boolean" ||
      (target.marketplacePath !== null &&
        plugin.marketplacePath !== target.marketplacePath) ||
      (target.remoteMarketplaceName !== null &&
        plugin.marketplaceName !== target.remoteMarketplaceName)
    )
      throw new HttpError(
        409,
        "Plugin read did not verify its original marketplace identity",
      );
    const remote =
      summary.remotePluginId ?? object(summary.shareContext).remotePluginId;
    if (
      summary.name !== target.pluginName &&
      remote !== target.pluginName &&
      summary.id !== target.pluginName
    )
      throw new HttpError(
        409,
        "Plugin native identity does not match its original target",
      );
    return { ...plugin, summary };
  }
  private async inspect(row: Saved, scope: string): Promise<Result> {
    const plugin = await this.detail(row.target, scope);
    if (plugin.summary.installed !== (row.operation === "install"))
      return {
        operationId: row.operationId,
        status: "unknown",
        appsNeedingAuth: [],
        plugin,
        error:
          "Plugin outcome remains unknown; no install or uninstall was resent",
      };
    await this.save({ ...row, status: "state-confirmed" });
    return {
      operationId: row.operationId,
      status: "state-confirmed",
      appsNeedingAuth: [],
      plugin,
      authPolicy: plugin.summary.authPolicy,
    };
  }
  async authentication(value: JsonObject) {
    if (
      Object.keys(value).some(
        (field) => !["target", "expectedScope", "appIds"].includes(field),
      ) ||
      !text(value.expectedScope, 64) ||
      !Array.isArray(value.appIds) ||
      value.appIds.length > 64 ||
      value.appIds.some((id) => !text(id))
    )
      throw new HttpError(400, "Invalid plugin authentication read");
    if (this.pending >= 8) throw new HttpError(429, "Plugin reads are busy");
    this.pending++;
    try {
      const scope = value.expectedScope,
        target = parseTarget(value.target),
        context = await this.options.context();
      if (context.scope !== scope)
        throw new HttpError(409, "Plugin account or runtime scope changed");
      const plugin = await this.detail(target, scope),
        allowed = new Set(
          (Array.isArray(plugin.apps) ? plugin.apps : []).map(
            (value) => object(value).id,
          ),
        ),
        states = new Map<string, boolean>();
      let cursor: Json = null,
        bytes = 0;
      const seen = new Set<string>();
      for (let page = 0; page < 8; page++) {
        this.assert(scope);
        const result = object(
          await this.options.call(
            "app/list",
            { cursor, limit: 100, forceRefetch: true },
            scope,
          ),
        );
        this.assert(scope);
        bytes += Buffer.byteLength(JSON.stringify(result));
        if (bytes > 1048576 || !Array.isArray(result.data))
          throw new HttpError(
            413,
            "Plugin authentication catalog exceeds its read budget",
          );
        for (const row of result.data) {
          const app = object(row);
          if (
            typeof app.id === "string" &&
            allowed.has(app.id) &&
            typeof app.isAccessible === "boolean"
          )
            states.set(app.id, app.isAccessible);
        }
        cursor = result.nextCursor ?? null;
        if (cursor === null) break;
        if (!text(cursor, 4096) || seen.has(cursor) || page === 7)
          throw new HttpError(
            502,
            "Plugin authentication catalog cursor is invalid",
          );
        seen.add(cursor);
      }
      return {
        apps: value.appIds.map((id) => ({
          id,
          isAccessible: states.get(String(id)) ?? null,
        })),
      };
    } finally {
      this.pending--;
    }
  }
  async change(value: JsonObject): Promise<Result> {
    if (
      Object.keys(value).some(
        (field) =>
          ![
            "operationId",
            "operation",
            "target",
            "expectedScope",
            "inspectOnly",
          ].includes(field),
      ) ||
      !text(value.operationId, 128) ||
      !["install", "uninstall"].includes(String(value.operation)) ||
      !text(value.expectedScope, 64) ||
      !/^[a-f0-9]{64}$/.test(value.expectedScope) ||
      (value.inspectOnly !== undefined &&
        typeof value.inspectOnly !== "boolean")
    )
      throw new HttpError(400, "Invalid plugin operation");
    const target = parseTarget(value.target),
      scope = value.expectedScope,
      operation = value.operation as Saved["operation"],
      operationId = value.operationId;
    if (this.pending >= 8)
      throw new HttpError(429, "Plugin changes are busy; no change admitted");
    this.pending++;
    try {
      const context = await this.options.context();
      if (context.scope !== scope)
        throw new HttpError(
          409,
          "NOT_SENT: plugin account or runtime scope changed",
        );
      return await this.serial.run(context.namespace, async () => {
        this.assert(scope);
        const rows = await this.read(),
          identity = key(target),
          previous = rows.find(
            (row) =>
              row.namespace === context.namespace &&
              row.operationId === operationId,
          );
        if (
          previous &&
          (key(previous.target) !== identity ||
            previous.operation !== operation)
        )
          throw new HttpError(
            409,
            "Plugin intent identity was reused for another target",
          );
        const unknown = rows.find(
          (row) =>
            row.namespace === context.namespace &&
            key(row.target) === identity &&
            row.status === "unknown",
        );
        if (unknown)
          return {
            ...(await this.inspect(unknown, scope)),
            operationId,
            sourceOperationId: unknown.operationId,
            operation: unknown.operation,
          };
        if (previous && previous.status !== "rejected")
          return {
            operationId,
            status: previous.status,
            appsNeedingAuth: [],
            plugin: await this.detail(previous.target, scope),
          };
        const plugin = await this.detail(target, scope);
        if (
          value.inspectOnly === true ||
          plugin.summary.installed === (operation === "install")
        )
          return {
            operationId,
            status: "state-confirmed",
            appsNeedingAuth: [],
            plugin,
            authPolicy: plugin.summary.authPolicy,
          };
        const row: Saved = {
          operationId,
          namespace: context.namespace,
          target,
          operation,
          status: "unknown",
          at: Date.now(),
        };
        await this.save(row);
        let mayHaveWritten = false;
        try {
          this.assert(scope);
          const pluginId =
            object(plugin.summary.source).type === "remote"
              ? (plugin.summary.remotePluginId ??
                object(plugin.summary.shareContext).remotePluginId)
              : plugin.summary.id;
          if (operation === "uninstall" && !text(pluginId))
            throw new Error(
              "NOT_SENT: native uninstall identity is unavailable",
            );
          const result = object(
            await this.options.call(
              "plugin/" + operation,
              operation === "install"
                ? target
                : { pluginId: pluginId as string },
              scope,
              () => {
                mayHaveWritten = true;
              },
            ),
          );
          if (
            operation === "install" &&
            (!["ON_INSTALL", "ON_USE"].includes(String(result.authPolicy)) ||
              !Array.isArray(result.appsNeedingAuth) ||
              result.appsNeedingAuth.length > 64 ||
              Buffer.byteLength(JSON.stringify(result)) > 128 * 1024)
          )
            throw new Error(
              "Native plugin install response is invalid or oversized",
            );
          await this.save({ ...row, status: "accepted" });
          return {
            operationId,
            status: "accepted",
            appsNeedingAuth:
              operation === "install"
                ? (result.appsNeedingAuth as Json[]).map(object)
                : [],
            authPolicy: result.authPolicy,
          };
        } catch (error) {
          const message =
              error instanceof Error ? error.message : String(error),
            status = mayHaveWritten ? "unknown" : "rejected";
          if (status === "rejected")
            await this.save({ ...row, status }).catch(() => {});
          return { operationId, status, appsNeedingAuth: [], error: message };
        }
      });
    } finally {
      this.pending--;
    }
  }
}
