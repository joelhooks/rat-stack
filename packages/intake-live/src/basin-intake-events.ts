import { IntakeEventsUnavailable } from "@rat-stack/core/intake";
import type {
  ContactRef,
  IntakeContact,
  IntakeStatement,
} from "@rat-stack/core/intake";
import { Context, DateTime, Effect, Schedule, Schema } from "effect";

import { IntakeRowSchema, erasedRow, recordRows } from "./intake-rows.js";
import type { IntakeRow, IntakeRowSource } from "./intake-rows.js";

export interface UnstructuredIntakeRow {
  readonly value: typeof IntakeRowSchema.Encoded;
}

export interface IntakeRowSink {
  readonly send: (
    rows: readonly UnstructuredIntakeRow[]
  ) => Effect.Effect<void, IntakeEventsUnavailable>;
}

export class IntakeBackfill extends Context.Service<
  IntakeBackfill,
  {
    readonly record: (
      statements: readonly IntakeStatement[],
      contact?: IntakeContact
    ) => Effect.Effect<void, IntakeEventsUnavailable>;
  }
>()("@rat-stack/intake-live/IntakeBackfill") {}

const encodeRow = Schema.encodeEffect(IntakeRowSchema);

const ERASE_RETRIES = 2;

const stampFor = (source: IntakeRowSource) =>
  DateTime.now.pipe(
    Effect.map((now) => ({ recordedAt: DateTime.formatIso(now), source }))
  );

export const basinIntakeEvents = (sink: IntakeRowSink) => {
  const write = (rows: readonly IntakeRow[]) =>
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach is the Effect combinator, not Array#forEach with a thisArg.
    Effect.forEach(rows, (row) =>
      encodeRow(row).pipe(Effect.map((value) => ({ value })))
    ).pipe(
      Effect.mapError(() => new IntakeEventsUnavailable({})),
      Effect.flatMap((encoded) => sink.send(encoded))
    );

  const recordFrom =
    (source: IntakeRowSource) =>
    (statements: readonly IntakeStatement[], contact?: IntakeContact) =>
      stampFor(source).pipe(
        Effect.flatMap((stamp) => write(recordRows(statements, contact, stamp)))
      );

  return {
    backfill: { record: recordFrom("backfill") },
    events: {
      erase: (actor: ContactRef) =>
        stampFor("live").pipe(
          Effect.flatMap((stamp) => write([erasedRow(actor, stamp)])),
          Effect.retry(Schedule.recurs(ERASE_RETRIES)),
          Effect.orDie
        ),
      record: recordFrom("live"),
    },
  } as const;
};
