import { Effect } from "effect";

import { D1 } from "../../../packages/database/src/d1.js";
import type { D1Options } from "../../../packages/database/src/d1.js";
import { HyperdrivePostgres } from "../../../packages/database/src/hyperdrive-postgres.js";
import type { HyperdrivePostgresOptions } from "../../../packages/database/src/hyperdrive-postgres.js";
import type { RecordRunInput } from "../../../packages/database/src/model.js";
import { RunLog } from "../../../packages/database/src/run-log.js";

const recordRun = (input: RecordRunInput) =>
  RunLog.use((log) => log.record(input));

export const onD1 = (input: RecordRunInput, options: D1Options) =>
  recordRun(input).pipe(Effect.provide(D1(options)));

export const onPostgres = (
  input: RecordRunInput,
  options: HyperdrivePostgresOptions
) => recordRun(input).pipe(Effect.provide(HyperdrivePostgres(options)));
