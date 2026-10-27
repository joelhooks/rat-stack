import { Clock, Context, Effect, Layer, Ref, Schema } from "effect";

import { ListFlagChangesInput } from "./flag-change.js";
import type { FlagChange, FlagChangesPage } from "./flag-change.js";
import { FlagStorageError } from "./flag-storage-error.js";

export const validateFlagChangeQuery = (
  input: typeof ListFlagChangesInput.Type
) =>
  Schema.decodeEffect(ListFlagChangesInput)(input).pipe(
    Effect.mapError(
      (cause) =>
        new FlagStorageError({
          cause,
          fallback: null,
          flag: "",
          operation: "listChanges",
          repair:
            "Supply a journal page limit from 1 to 100 and an optional cursor.",
        })
    )
  );

export class FlagJournal extends Context.Service<
  FlagJournal,
  {
    readonly record: (
      change: FlagChange
    ) => Effect.Effect<void, FlagStorageError>;
    readonly list: (
      input: typeof ListFlagChangesInput.Type
    ) => Effect.Effect<typeof FlagChangesPage.Type, FlagStorageError>;
  }
>()("@rat-stack/core/FlagJournal") {
  static memory = Layer.effect(
    FlagJournal,
    Effect.gen(function* makeFlagJournal() {
      const entries = yield* Ref.make<readonly FlagChange[]>([]);

      return FlagJournal.of({
        list: Effect.fn("FlagJournal.list")(function* list(input) {
          const query = yield* validateFlagChangeQuery(input);
          const now = yield* Clock.currentTimeMillis;
          const current = yield* Ref.get(entries);

          const latest = new Map(
            current.map((entry) => [entry.attemptId, entry])
          );

          const ordered = [...latest.values()].toSorted((left, right) =>
            left.attemptId.localeCompare(right.attemptId)
          );

          const { cursor: after } = query;

          const remaining =
            after === undefined
              ? ordered
              : ordered.filter((entry) => entry.attemptId > after);

          const page = remaining.slice(0, query.limit);

          const cursor =
            remaining.length > page.length ? page.at(-1)?.attemptId : undefined;

          return {
            changes: page.map((entry) => ({
              ...entry,
              ageMillis: Math.max(0, now - entry.recordedAt),
            })),
            cursor,
          };
        }),
        record: (change) =>
          Ref.update(entries, (current) => [...current, change]),
      });
    })
  );
}
