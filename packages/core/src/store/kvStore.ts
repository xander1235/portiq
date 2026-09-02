import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { resolveDataDir, resolveDbPath, type ResolveDataDirOptions } from "./dataDir";

export class ConflictError extends Error {
  constructor(public key: string, public expected: number, public actual: number) {
    super(`Optimistic write conflict on "${key}": expected version ${expected}, found ${actual}`);
    this.name = "ConflictError";
  }
}

export interface KvStore {
  get(key: string): string | null;
  getVersioned(key: string): { value: string | null; version: number };
  set(key: string, value: string): number;
  setIfVersion(key: string, value: string, expectedVersion: number): number;
  keys(prefix?: string): string[];
  deleteKey(key: string): void;
  transaction<T>(fn: () => T): T;
  clear(): void;
  close(): void;
  /**
   * Global monotonic counter bumped on EVERY mutating op (set, a successful
   * setIfVersion, deleteKey) — unlike per-key versions, it advances even when
   * an existing entity row is edited in place. Used by the desktop watcher to
   * detect external writes regardless of which key changed. Stored as a
   * reserved row in kv_version (no corresponding kv row), so it is never
   * returned by keys() and never observed by recomposeState/loadState.
   */
  globalWriteVersion(): number;
}

export function openKvStore(opts: ResolveDataDirOptions = {}): KvStore {
  const dir = resolveDataDir(opts);
  mkdirSync(dir, { recursive: true });
  const db = new Database(resolveDbPath(opts));
  db.pragma("journal_mode = WAL");
  db.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)").run();
  db.prepare("CREATE TABLE IF NOT EXISTS kv_version (key TEXT PRIMARY KEY, version INTEGER NOT NULL)").run();

  const readValue = db.prepare("SELECT value FROM kv WHERE key = ?");
  const readVersion = db.prepare("SELECT version FROM kv_version WHERE key = ?");
  const upsertValue = db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const upsertVersion = db.prepare(
    "INSERT INTO kv_version (key, version) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET version = excluded.version"
  );

  function currentVersion(key: string): number {
    const row = readVersion.get(key) as { version: number } | undefined;
    return row ? row.version : 0;
  }

  // Reserved kv_version-only key (no kv row) backing the global write counter.
  // Not a valid app key (app keys are "appState", "ent:index", "ent:col:*",
  // "ent:env:*", etc.), so it never collides and never leaks into keys()/state.
  const WRITE_SEQ_KEY = "__writeseq__";

  function bumpWriteSeq(): number {
    const next = currentVersion(WRITE_SEQ_KEY) + 1;
    upsertVersion.run(WRITE_SEQ_KEY, next);
    return next;
  }

  const writeTxn = db.transaction((key: string, value: string, expected: number | null): number => {
    const actual = currentVersion(key);
    if (expected !== null && expected !== actual) throw new ConflictError(key, expected, actual);
    const next = actual + 1;
    upsertValue.run(key, value);
    upsertVersion.run(key, next);
    bumpWriteSeq();
    return next;
  });

  const deleteValue = db.prepare("DELETE FROM kv WHERE key = ?");
  const deleteVersion = db.prepare("DELETE FROM kv_version WHERE key = ?");
  const deleteTxn = db.transaction((key: string): void => {
    deleteValue.run(key);
    deleteVersion.run(key);
    bumpWriteSeq();
  });

  return {
    get(key) {
      const row = readValue.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },
    getVersioned(key) {
      const row = readValue.get(key) as { value: string } | undefined;
      return { value: row ? row.value : null, version: currentVersion(key) };
    },
    set(key, value) {
      return writeTxn(key, value, null);
    },
    setIfVersion(key, value, expectedVersion) {
      return writeTxn(key, value, expectedVersion);
    },
    keys(prefix) {
      const rows = prefix
        ? db.prepare("SELECT key FROM kv WHERE key LIKE ? || '%'").all(prefix)
        : db.prepare("SELECT key FROM kv").all();
      return (rows as { key: string }[]).map((r) => r.key);
    },
    deleteKey(key) {
      deleteTxn(key);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
    clear() {
      db.prepare("DELETE FROM kv").run();
      db.prepare("DELETE FROM kv_version").run();
    },
    close() {
      db.close();
    },
    globalWriteVersion() {
      return currentVersion(WRITE_SEQ_KEY);
    },
  };
}
