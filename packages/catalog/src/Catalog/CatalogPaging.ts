import type * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { authorIdentityKey } from "./AuthorIdentity.ts";
import { queryTake } from "./CatalogValues.ts";
import type { RepeatAuthorsInput, RisingInput } from "./CatalogValues.ts";
import { InvalidCatalogCursor } from "./InvalidCatalogCursor.rejection.ts";
import { InvalidCatalogInput } from "./InvalidCatalogInput.rejection.ts";

const Cursor = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.Literals(["Rising", "RepeatAuthors"]),
    scope: Schema.String,
    rank: Schema.Natural,
    key: Schema.NonEmptyString,
  })
);

const Page = Schema.Struct({
  take: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: queryTake.max })
  ),
  after: Schema.UndefinedOr(Schema.String),
});

export const validateCatalogPage = (
  page: Domain.Query.PageRequest,
  operation: "rising" | "repeatAuthors"
) =>
  Schema.decodeEffect(Page)(page).pipe(
    Effect.mapError((cause) => new InvalidCatalogInput({ operation, cause }))
  );

export const risingScope = (input: typeof RisingInput.Type) =>
  JSON.stringify({
    from: DateTime.toEpochMillis(input.from),
    until: DateTime.toEpochMillis(input.until),
    metric: input.metric,
  });

export const repeatAuthorsScope = (input: typeof RepeatAuthorsInput.Type) =>
  JSON.stringify({
    from: DateTime.toEpochMillis(input.from),
    until: DateTime.toEpochMillis(input.until),
    minimumItems: input.minimumItems,
    excludedAuthors: [
      ...new Set(input.excludedAuthors.map(authorIdentityKey)),
    ].toSorted(compareCatalogText),
  });

export const readCatalogCursor = Effect.fn("readCatalogCursor")(
  function* readCatalogCursor(
    query: "Rising" | "RepeatAuthors",
    scope: string,
    after: string | undefined
  ) {
    if (after === undefined) {
      return null;
    }

    const cursor = yield* Schema.decodeEffect(Cursor)(after).pipe(
      // oxlint-disable-next-line anti-slop-effect/require-cause-when-narrowing -- The cursor is an opaque client token; this Domain rejection crosses the operator wire outside wireFailureSchema and deliberately says only that the cursor is invalid.
      Effect.mapError(() => new InvalidCatalogCursor())
    );

    if (cursor.query !== query || cursor.scope !== scope) {
      return yield* new InvalidCatalogCursor();
    }

    return cursor;
  }
);

export const catalogPage = <Row>(
  query: "Rising" | "RepeatAuthors",
  scope: string,
  rows: readonly Row[],
  page: Domain.Query.PageRequest,
  position: (row: Row) => { readonly rank: number; readonly key: string }
): Domain.Query.Page<Row> => {
  const entries = rows.slice(0, page.take);
  const last = entries.at(-1);

  return {
    entries,
    cursor:
      rows.length > page.take && last !== undefined
        ? JSON.stringify({ query, scope, ...position(last) })
        : null,
  };
};

export const compareCatalogText = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a.at(index) ?? 0) - (b.at(index) ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return a.length - b.length;
};
