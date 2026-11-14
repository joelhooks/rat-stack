import { createHash, randomBytes } from "node:crypto";

import { Schema } from "effect";

/** One job run. `run_` + base36 time + 12 random hex chars. Safe as a directory name. */
export const RunId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^run_[0-9a-z]+_[0-9a-f]{12}$/)),
  Schema.brand("RunId")
);
export type RunId = typeof RunId.Type;

/** A content-addressed result. See `resultIdFor`. */
export const ResultId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^res_[0-9a-f]{16}$/)),
  Schema.brand("ResultId")
);
export type ResultId = typeof ResultId.Type;

export type Bytes = Uint8Array | string;

export function sha256(bytes: Bytes): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stamped(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

/** A new run ID, unique per call. */
export function newRunId(): RunId {
  return parseRunId(stamped("run"));
}

/**
 * The result ID for these bytes in this run: `res_` + the first 16 hex chars of
 * sha256(runId + "\0" + bytes). The same bytes in another run get another ID.
 */
export function resultIdFor(runId: RunId, bytes: Bytes): ResultId {
  const hash = createHash("sha256")
    .update(runId)
    .update("\0")
    .update(bytes)
    .digest("hex");
  return parseResultId(`res_${hash.slice(0, 16)}`);
}

export const parseRunId = Schema.decodeUnknownSync(RunId);
export const parseResultId = Schema.decodeUnknownSync(ResultId);
