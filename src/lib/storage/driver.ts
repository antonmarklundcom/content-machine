/**
 * The storage adapter's contract (PLAN.md §1.41): three tiers, one interface.
 * `local` is `MEDIA_ROOT` (the external drive), `hostinger` is the public copy
 * on the EU account's `media.` subdomain; O14 adds a read-only Drive driver.
 *
 * Every call returns a typed result instead of throwing for the states that
 * are normal here — an unplugged drive, a file that is gone, a public endpoint
 * that is not configured — so a page can say what happened and never 500s.
 */

export type StorageFailure = {
  ok: false;
  /**
   * `missing`: the storage itself is not there (drive unplugged, endpoint not
   * configured). `not_found`: the storage is there, the file is not.
   * `rejected`: a bad path or a refused file. `unwritable`, `error`: the rest.
   */
  reason: "missing" | "not_found" | "rejected" | "unwritable" | "error";
  message: string;
};

export type PutResult =
  | {
      ok: true;
      /** Where the driver stored it: relative to `MEDIA_ROOT` for local, the server's key for hostinger. */
      key: string;
      /** Set by drivers that serve files publicly. */
      url?: string;
      bytes: number;
    }
  | StorageFailure;

export type GetResult = { ok: true; data: Buffer; mime?: string } | StorageFailure;

export type ExistsResult = { ok: true; exists: boolean } | StorageFailure;

export type RemoveResult = { ok: true; removed: boolean } | StorageFailure;

export type PutOptions = {
  /** The media type, when the caller knows it; the hostinger endpoint sniffs anyway. */
  mime?: string;
  /** Replace a file already at `key` (local only). Default false: an existing file is a `rejected`. */
  overwrite?: boolean;
  /** Bound a public upload while publication holds row locks (local ignores this). */
  timeoutMs?: number;
};

export interface StorageDriver {
  readonly name: "local" | "hostinger";
  /**
   * Store `data` (bytes, or the absolute path of a file to copy) at `key`.
   * The hostinger endpoint chooses its own random name; `key` is only a hint
   * for its extension.
   */
  put(key: string, data: Buffer | { file: string }, options?: PutOptions): Promise<PutResult>;
  get(key: string): Promise<GetResult>;
  exists(key: string): Promise<ExistsResult>;
  remove(key: string): Promise<RemoveResult>;
  /** The public URL of a stored key, for drivers that have one. */
  publicUrl?(key: string): string;
}

export function failure(reason: StorageFailure["reason"], message: string): StorageFailure {
  return { ok: false, reason, message };
}
