import { Effect } from "effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import type { SightingRecorded } from "../Item/RecordSighting.command.ts";
import { authorIdentityKey, normalizeAuthor } from "./AuthorIdentity.ts";
import {
  catalogPage,
  risingScope,
  repeatAuthorsScope,
  compareCatalogText,
  readCatalogCursor,
  validateCatalogPage,
} from "./CatalogPaging.ts";
import { CatalogStore } from "./CatalogStore.ts";
import { CatalogUnavailable } from "./CatalogUnavailable.rejection.ts";
import {
  CatalogEventRow,
  editorialDecisionOf,
  validateCatalogRows,
  validateRepeatAuthorsInput,
  validateRisingInput,
} from "./CatalogValues.ts";
import type {
  EditorialDecision,
  RepeatAuthorsInput,
  RisingEntry,
  RisingInput,
} from "./CatalogValues.ts";

interface StoredCatalogRow {
  readonly row: typeof CatalogEventRow.Type;
  readonly encoded: string;
}

interface Observation {
  readonly item: typeof CatalogEventRow.Type.item;
  readonly id: string;
  readonly seq: number;
  readonly event: SightingRecorded;
}

const observationsIn = (
  rows: readonly (typeof CatalogEventRow.Type)[],
  input: typeof RisingInput.Type | typeof RepeatAuthorsInput.Type
) =>
  rows.flatMap((row) => {
    if (!Predicate.isTagged(row.event, "SightingRecorded")) {
      return [];
    }

    const at = DateTime.toEpochMillis(row.event.observedAt);

    return at >= DateTime.toEpochMillis(input.from) &&
      at < DateTime.toEpochMillis(input.until)
      ? [
          {
            item: row.item,
            id: `${row.stream}:${row.seq}`,
            seq: row.seq,
            event: row.event,
          },
        ]
      : [];
  });

const currentDecisions = (rows: readonly (typeof CatalogEventRow.Type)[]) => {
  const latest = new Map<
    string,
    { readonly seq: number; readonly decision: typeof EditorialDecision.Type }
  >();

  for (const row of rows) {
    const decision = editorialDecisionOf(row.event);
    const previous = latest.get(row.item);

    if (
      decision !== null &&
      (previous === undefined || row.seq > previous.seq)
    ) {
      latest.set(row.item, { seq: row.seq, decision });
    }
  }

  return latest;
};

const risingEntries = (
  rows: readonly Observation[],
  input: typeof RisingInput.Type,
  decisions: ReturnType<typeof currentDecisions>
) => {
  const groups = new Map<string, Observation[]>();

  for (const row of rows) {
    if (row.event.metrics[input.metric] !== undefined) {
      const key = `${row.item}\u0000${row.event.source}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  }

  const best = new Map<string, typeof RisingEntry.Type>();

  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        DateTime.toEpochMillis(left.event.observedAt) -
          DateTime.toEpochMillis(right.event.observedAt) ||
        left.seq - right.seq ||
        compareCatalogText(left.id, right.id)
    );
    const first = group.at(0);
    const last = group.at(-1);
    const firstValue = first?.event.metrics[input.metric];
    const lastValue = last?.event.metrics[input.metric];

    if (
      group.length < 2 ||
      first === undefined ||
      last === undefined ||
      firstValue === undefined ||
      lastValue === undefined ||
      lastValue <= firstValue
    ) {
      continue;
    }

    const entry: typeof RisingEntry.Type = {
      item: last.item,
      kind: last.event.kind,
      source: last.event.source,
      metric: input.metric,
      firstAt: first.event.observedAt,
      lastAt: last.event.observedAt,
      from: firstValue,
      to: lastValue,
      gain: lastValue - firstValue,
      relativeGain:
        firstValue === 0 ? null : (lastValue - firstValue) / firstValue,
      decision: decisions.get(last.item)?.decision ?? "none",
    };

    const previous = best.get(entry.item);

    if (
      previous === undefined ||
      entry.gain > previous.gain ||
      (entry.gain === previous.gain &&
        compareCatalogText(entry.source, previous.source) < 0)
    ) {
      best.set(entry.item, entry);
    }
  }

  return [...best.values()].toSorted(
    (left, right) =>
      right.gain - left.gain || compareCatalogText(left.item, right.item)
  );
};

export const CatalogMemory = Layer.effect(
  CatalogStore,
  Effect.gen(function* makeCatalogMemory() {
    const state = yield* Ref.make(new Map<string, StoredCatalogRow>());

    const quarantined = yield* Ref.make(new Map<string, string>());

    return CatalogStore.of({
      quarantine: (row, reason) =>
        Ref.update(quarantined, (current) =>
          new Map(current).set(`${row.stream}:${row.seq}`, reason)
        ),
      record: Effect.fn("CatalogMemory.record")(function* record(rows) {
        const parsed = yield* validateCatalogRows(rows);

        const encodedRows = yield* Effect.forEach(
          (row: typeof CatalogEventRow.Type) =>
            Schema.encodeEffect(Schema.fromJsonString(CatalogEventRow))(
              row
            ).pipe(
              Effect.map((encoded) => ({ row, encoded })),
              Effect.mapError(
                (cause) =>
                  new CatalogUnavailable({ operation: "record", cause })
              )
            )
        )(parsed);

        const conflict = yield* Ref.modify(
          state,
          (current): [string | null, Map<string, StoredCatalogRow>] => {
            const next = new Map(current);

            for (const value of encodedRows) {
              const key = `${value.row.stream}:${value.row.seq}`;
              const previous = next.get(key);

              if (
                previous !== undefined &&
                previous.encoded !== value.encoded
              ) {
                return [key, current];
              }

              next.set(key, value);
            }

            return [null, next];
          }
        );

        if (conflict !== null) {
          return yield* new CatalogUnavailable({
            operation: "record",
            cause: new Error(`Divergent catalog replay at ${conflict}`),
          });
        }

        return yield* Effect.void;
      }),
      rising: Effect.fn("CatalogMemory.rising")(function* rising(input, page) {
        yield* validateRisingInput(input);
        yield* validateCatalogPage(page, "rising");
        const scope = risingScope(input);
        const cursor = yield* readCatalogCursor("Rising", scope, page.after);

        const allRows = [...(yield* Ref.get(state)).values()].map(
          (value) => value.row
        );

        const rows = observationsIn(allRows, input);

        const entries = risingEntries(
          rows,
          input,
          currentDecisions(allRows)
        ).filter(
          (entry) =>
            cursor === null ||
            entry.gain < cursor.rank ||
            (entry.gain === cursor.rank &&
              compareCatalogText(entry.item, cursor.key) > 0)
        );

        return catalogPage("Rising", scope, entries, page, (entry) => ({
          rank: entry.gain,
          key: entry.item,
        }));
      }),
      repeatAuthors: Effect.fn("CatalogMemory.repeatAuthors")(
        function* repeatAuthors(input, page) {
          yield* validateRepeatAuthorsInput(input);
          yield* validateCatalogPage(page, "repeatAuthors");
          const scope = repeatAuthorsScope(input);

          const cursor = yield* readCatalogCursor(
            "RepeatAuthors",
            scope,
            page.after
          );

          const excluded = new Set(
            input.excludedAuthors.map(authorIdentityKey)
          );

          const authors = new Map<
            string,
            {
              readonly source: string;
              readonly author: string;
              readonly items: Set<string>;
            }
          >();

          const rows = observationsIn(
            [...(yield* Ref.get(state)).values()].map((value) => value.row),
            input
          );

          for (const { item, event } of rows) {
            if (event.author === undefined) {
              continue;
            }

            const identity = {
              source: event.source,
              author: normalizeAuthor(event.author),
            };

            const key = authorIdentityKey(identity);

            if (!excluded.has(key)) {
              const group = authors.get(key) ?? {
                ...identity,
                items: new Set<string>(),
              };

              group.items.add(item);
              authors.set(key, group);
            }
          }

          const entries = [...authors]
            .flatMap(([key, group]) => {
              const count = group.items.size;

              const follows =
                cursor === null ||
                count < cursor.rank ||
                (count === cursor.rank &&
                  compareCatalogText(key, cursor.key) > 0);

              return count >= input.minimumItems && follows
                ? [{ source: group.source, author: group.author, items: count }]
                : [];
            })
            .toSorted(
              (left, right) =>
                right.items - left.items ||
                compareCatalogText(
                  authorIdentityKey(left),
                  authorIdentityKey(right)
                )
            );

          return catalogPage(
            "RepeatAuthors",
            scope,
            entries,
            page,
            (entry) => ({ rank: entry.items, key: authorIdentityKey(entry) })
          );
        }
      ),
    });
  })
);
