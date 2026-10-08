import { and, eq, getTableColumns, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlColumn, type MySqlTable } from "drizzle-orm/mysql-core";
import type { MySqlInsertValue } from "drizzle-orm/mysql-core/query-builders/insert";
import type { MySqlUpdateSetSource } from "drizzle-orm/mysql-core/query-builders/update";
import type { SelectedFieldsFlat } from "drizzle-orm/mysql-core/query-builders/select.types";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import type { Db } from "./index";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbHandle = Db | Tx;
type Projection = SelectedFieldsFlat;
type Returned<T extends MySqlTable, P extends Projection | undefined> = P extends Projection
  ? SelectResultFields<P>
  : T["$inferSelect"];
type Values<T extends MySqlTable> = MySqlInsertValue<T> | MySqlInsertValue<T>[];
type Conflict<T extends MySqlTable> = {
  target?: AnyMySqlColumn | AnyMySqlColumn[];
  set?: MySqlUpdateSetSource<T>;
  setWhere?: SQL;
};

/** Only native duplicate-key errors are recoverable; FK/truncation/connection errors propagate. */
export function isDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { errno?: number; code?: string; cause?: unknown };
  return (
    e.errno === 1062 ||
    e.code === "ER_DUP_ENTRY" ||
    (e.cause !== undefined && isDuplicateKey(e.cause))
  );
}
function isTransaction(handle: DbHandle): handle is Tx {
  return "rollback" in handle;
}
async function atomic<R>(handle: DbHandle, fn: (tx: Tx) => Promise<R>): Promise<R> {
  if (isTransaction(handle)) return fn(handle);
  return handle.transaction(fn, { isolationLevel: "read committed" });
}
function keyColumns(table: MySqlTable): AnyMySqlColumn[] {
  const config = getTableConfig(table);
  const keys = config.primaryKeys.flatMap((key) => key.columns);
  return keys.length ? keys : config.columns.filter((col) => col.primary);
}
function keySelection(table: MySqlTable): Record<string, AnyMySqlColumn> {
  const columns = getTableColumns(table),
    keys = new Set(keyColumns(table));
  const result = Object.fromEntries(Object.entries(columns).filter(([, col]) => keys.has(col)));
  if (!Object.keys(result).length) throw new Error("Mutation requires a declared primary key.");
  return result;
}
function rowPredicate(table: MySqlTable, row: Record<string, unknown>): SQL {
  const keys = keySelection(table);
  const conditions = Object.entries(keys).map(([key, col]) => eq(col, row[key]));
  return and(...conditions)!;
}
async function selected<T extends MySqlTable, P extends Projection | undefined>(
  tx: Tx,
  table: T,
  where: SQL | undefined,
  projection: P,
): Promise<Returned<T, P>[]> {
  const fields = projection ?? getTableColumns(table);
  return (await tx.select(fields).from(table).where(where).for("update")) as unknown as Returned<
    T,
    P
  >[];
}
async function inserted<T extends MySqlTable, P extends Projection | undefined>(
  tx: Tx,
  table: T,
  value: MySqlInsertValue<T>,
  projection: P,
): Promise<Returned<T, P>[]> {
  const [result] = await tx.insert(table).values(value);
  const record = value as Record<string, unknown>;
  const identity: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(keySelection(table))) {
    const supplied = record[key];
    if (supplied !== undefined && !(supplied instanceof Object)) identity[key] = supplied;
    else if ("autoIncrement" in col && col.autoIncrement) identity[key] = result.insertId;
    else
      throw new Error(
        "Returning an inserted row requires a literal primary key or auto-increment identity.",
      );
  }
  // Read the row through its own connection, before another writer can alter it.
  return selected(tx, table, rowPredicate(table, identity), projection);
}
export async function insertReturning<
  T extends MySqlTable,
  P extends Projection | undefined = undefined,
>(handle: DbHandle, table: T, values: Values<T>, projection?: P): Promise<Returned<T, P>[]> {
  const list = Array.isArray(values) ? values : [values];
  if (!list.length) return [];
  return atomic(handle, async (tx) => {
    const rows: Returned<T, P>[] = [];
    for (const value of list) rows.push(...(await inserted(tx, table, value, projection as P)));
    return rows;
  });
}
export async function updateReturning<
  T extends MySqlTable,
  P extends Projection | undefined = undefined,
>(
  handle: DbHandle,
  table: T,
  patch: MySqlUpdateSetSource<T>,
  where: SQL | undefined,
  projection?: P,
): Promise<Returned<T, P>[]> {
  return atomic(handle, async (tx) => {
    const keys = await tx.select(keySelection(table)).from(table).where(where).for("update");
    if (!keys.length) return [];
    // Restrict writes to the captured primary keys. At READ COMMITTED a broad
    // predicate can gain phantoms or become true for more rows as time advances.
    const rows: Returned<T, P>[] = [];
    for (const key of keys) {
      const identity = rowPredicate(table, key);
      const [result] = await tx.update(table).set(patch).where(and(identity, where));
      // FOUND_ROWS counts matched rows, including an intentional no-op update.
      if (result.affectedRows) rows.push(...(await selected(tx, table, identity, projection as P)));
    }
    return rows;
  });
}
export async function deleteReturning<
  T extends MySqlTable,
  P extends Projection | undefined = undefined,
>(handle: DbHandle, table: T, where: SQL | undefined, projection?: P): Promise<Returned<T, P>[]> {
  return atomic(handle, async (tx) => {
    const keys = await tx.select(keySelection(table)).from(table).where(where).for("update");
    const rows: Returned<T, P>[] = [];
    for (const key of keys) {
      const identity = rowPredicate(table, key);
      const before = await selected(tx, table, identity, projection as P);
      const [result] = await tx.delete(table).where(and(identity, where));
      if (result.affectedRows) rows.push(...before);
    }
    return rows;
  });
}
function conflictPredicate<T extends MySqlTable>(
  table: T,
  value: MySqlInsertValue<T>,
  config: Conflict<T>,
): SQL | undefined {
  if (!config.target) return undefined;
  const columns = getTableColumns(table),
    record = value as Record<string, unknown>;
  const targets = Array.isArray(config.target) ? config.target : [config.target];
  const predicates: SQL[] = [];
  for (const col of targets) {
    const key = Object.entries(columns).find(([, c]) => c === col)?.[0];
    if (!key) throw new Error("Conflict target must belong to the inserted table.");
    const v = record[key];
    // SQL expressions and NULL cannot safely identify the requested conflicting row.
    if (v === null || v === undefined || typeof v === "object") return undefined;
    predicates.push(eq(col, v));
  }
  return and(...predicates);
}
async function conflictRows<T extends MySqlTable, P extends Projection | undefined>(
  tx: Tx,
  table: T,
  value: MySqlInsertValue<T>,
  config: Conflict<T>,
  projection: P,
  duplicate: unknown,
): Promise<Returned<T, P>[]> {
  const where = conflictPredicate(table, value, config);
  if (!where) {
    if (!config.target && !config.set) return [];
    throw duplicate;
  }
  const locked = await tx.select(keySelection(table)).from(table).where(where).for("update");
  // Another unique key may have failed. Never update/ignore an unrelated record.
  if (!locked.length) throw duplicate;
  if (!config.set) return [];
  const updateWhere = config.setWhere ? and(where, config.setWhere) : where;
  return updateReturning(tx, table, config.set, updateWhere, projection);
}
export async function insertIfAbsent<
  T extends MySqlTable,
  P extends Projection | undefined = undefined,
>(
  handle: DbHandle,
  table: T,
  values: Values<T>,
  config: Conflict<T> = {},
  projection?: P,
): Promise<Returned<T, P>[]> {
  return upsertReturning(handle, table, values, config, projection);
}
export async function upsertReturning<
  T extends MySqlTable,
  P extends Projection | undefined = undefined,
>(
  handle: DbHandle,
  table: T,
  values: Values<T>,
  config: Conflict<T>,
  projection?: P,
): Promise<Returned<T, P>[]> {
  const list = Array.isArray(values) ? values : [values];
  if (!list.length) return [];
  return atomic(handle, async (tx) => {
    const result: Returned<T, P>[] = [];
    for (const value of list) {
      try {
        result.push(...(await inserted(tx, table, value, projection as P)));
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        result.push(...(await conflictRows(tx, table, value, config, projection as P, error)));
      }
    }
    return result;
  });
}
/** mysql2 returns [rows, fields], unlike PostgreSQL's {rows}. */
export async function queryRows<T extends object>(handle: DbHandle, query: SQL): Promise<T[]> {
  const [rows] = await handle.execute(query);
  if (!Array.isArray(rows)) throw new Error("queryRows expects a SELECT result.");
  return rows as T[];
}
