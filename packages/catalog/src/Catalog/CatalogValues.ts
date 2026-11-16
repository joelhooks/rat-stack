import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";

import { ItemDropped } from "../Item/Drop.command.ts";
import { ItemId } from "../Item/Item.id.ts";
import { ItemKept } from "../Item/Keep.command.ts";
import { SightingRecorded } from "../Item/RecordSighting.command.ts";
import { ItemKind } from "../Item/Sighting.ts";
import { AuthorIdentity } from "./AuthorIdentity.ts";
import { InvalidCatalogInput } from "./InvalidCatalogInput.rejection.ts";
import { InvalidWindow } from "./InvalidWindow.rejection.ts";

export const maximumWindowDays = 30;

export const queryTake = { default: 50, max: 200 };

export const WindowFields = {
  from: Schema.DateTimeUtcFromString,
  until: Schema.DateTimeUtcFromString,
};

export const CatalogEventRow = Schema.Struct({
  item: ItemId,
  stream: Schema.NonEmptyString,
  seq: Schema.Int.check(Schema.isGreaterThan(0)),
  recordedAt: Schema.DateTimeUtcFromString,
  event: Schema.Union([SightingRecorded, ItemKept, ItemDropped]),
});

export const RisingInput = Schema.Struct({
  ...WindowFields,
  metric: Schema.Literals(["stars", "views"]),
});

export const RepeatAuthorsInput = Schema.Struct({
  ...WindowFields,
  minimumItems: Schema.Int.check(Schema.isGreaterThan(0)),
  excludedAuthors: Schema.Array(AuthorIdentity).check(Schema.isMaxLength(500)),
});

export const EditorialDecision = Schema.Literals(["kept", "dropped", "none"]);

export const editorialDecisionOf = (event: typeof CatalogEventRow.Type.event) =>
  Match.value(event).pipe(
    Match.tags({
      ItemKept: (): "kept" => "kept",
      ItemDropped: (): "dropped" => "dropped",
      SightingRecorded: () => null,
    }),
    Match.exhaustive
  );

export const RisingEntry = Schema.Struct({
  item: ItemId,
  kind: ItemKind,
  source: Schema.NonEmptyString,
  metric: Schema.Literals(["stars", "views"]),
  firstAt: Schema.DateTimeUtcFromString,
  lastAt: Schema.DateTimeUtcFromString,
  from: Schema.Natural,
  to: Schema.Natural,
  gain: Schema.Int.check(Schema.isGreaterThan(0)),
  relativeGain: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))),
  decision: EditorialDecision,
});

export const RepeatAuthorEntry = Schema.Struct({
  ...AuthorIdentity.fields,
  items: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const validateWindow = (
  input: typeof RisingInput.Type | typeof RepeatAuthorsInput.Type
) => {
  const span =
    DateTime.toEpochMillis(input.until) - DateTime.toEpochMillis(input.from);

  return span > 0 && span <= maximumWindowDays * 86_400_000
    ? Effect.void
    : Effect.fail(new InvalidWindow({ maximumDays: maximumWindowDays }));
};

export const validateRisingInput = (input: typeof RisingInput.Type) =>
  Schema.decodeEffect(Schema.toType(RisingInput))(input).pipe(
    Effect.mapError(
      (cause) => new InvalidCatalogInput({ operation: "rising", cause })
    ),
    Effect.tap(validateWindow)
  );

export const validateRepeatAuthorsInput = (
  input: typeof RepeatAuthorsInput.Type
) =>
  Schema.decodeEffect(Schema.toType(RepeatAuthorsInput))(input).pipe(
    Effect.mapError(
      (cause) => new InvalidCatalogInput({ operation: "repeatAuthors", cause })
    ),
    Effect.tap(validateWindow)
  );

export const validateCatalogRows = (
  rows: readonly (typeof CatalogEventRow.Type)[]
) =>
  Schema.decodeEffect(Schema.Array(Schema.toType(CatalogEventRow)))(rows).pipe(
    Effect.mapError(
      (cause) => new InvalidCatalogInput({ operation: "record", cause })
    )
  );
