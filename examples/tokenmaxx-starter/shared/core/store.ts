import { randomBytes } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { Result, Schema } from "effect";

export type StoreFailure = "missing" | "unparseable" | "invalid";

/**
 * A read that did not produce a valid value. `missing`: no file. `unparseable`:
 * not JSON. `invalid`: JSON that does not match the schema.
 */
export class StoreError extends Error {
  readonly _tag = "StoreError";
  readonly reason: StoreFailure;
  readonly path: string;

  constructor(reason: StoreFailure, path: string, detail: string) {
    super(`${reason}: ${path}: ${detail}`);
    this.reason = reason;
    this.path = path;
  }
}

export function isStoreError(error: unknown): error is StoreError {
  return error instanceof StoreError;
}

/** Any Effect schema that decodes to `A` without services. */
export type Decoder<A> = Schema.ConstraintDecoder<A>;

export type ReadOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: StoreError };

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Reads and parses a JSON file. Throws `StoreError` when it is missing, not JSON, or off-schema. */
export async function readJson<A>(
  path: string,
  schema: Decoder<A>
): Promise<A> {
  const outcome = await tryReadJson(path, schema);
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

/** Like `readJson`, but returns the failure instead of throwing it. */
export async function tryReadJson<A>(
  path: string,
  schema: Decoder<A>
): Promise<ReadOutcome<A>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: new StoreError("missing", path, errorMessage(error)),
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: new StoreError("unparseable", path, errorMessage(error)),
    };
  }
  const decoded = Schema.decodeUnknownResult(schema)(raw);
  if (Result.isFailure(decoded)) {
    return {
      ok: false,
      error: new StoreError("invalid", path, decoded.failure.message),
    };
  }
  return { ok: true, value: decoded.success };
}

/**
 * Writes `value` as JSON so readers see the old file or the new one, never half
 * of one: temp file in the same dir, fsync, rename, fsync the dir.
 */
export async function writeJsonAtomic(
  path: string,
  value: unknown
): Promise<void> {
  await writeBytesAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Atomic write for raw bytes. Same steps as `writeJsonAtomic`. */
export async function writeBytesAtomic(
  path: string,
  bytes: Uint8Array | string
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(
    dir,
    `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await syncDir(dir);
}

async function syncDir(dir: string): Promise<void> {
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } catch {
    // Some filesystems refuse fsync on a directory; the rename already landed.
  } finally {
    await handle.close();
  }
}

/** True for the temp files `writeBytesAtomic` leaves only while a write is in flight. */
export function isTempFile(name: string): boolean {
  return name.startsWith(".") && name.endsWith(".tmp");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
