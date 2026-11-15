import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { OperatorToken } from "../Operator.middleware.ts";
import { ItemId } from "./Item.id.ts";
import { ItemKind, Sighting } from "./Sighting.ts";

export class KindMismatch extends Domain.Rejection("KindMismatch", {
  recorded: ItemKind,
  requested: ItemKind,
}) {}

export class SightingRecorded extends Domain.Event("SightingRecorded", {
  ...Sighting.fields,
  sightingKey: Schema.String,
}) {}

export class RecordSighting extends Domain.Command(
  "RecordSighting",
  {
    target: ItemId,
    middleware: [OperatorToken],
    input: Sighting.fields,
    events: [SightingRecorded],
    rejects: [KindMismatch],
  },
  {
    description:
      "Record the first observation of an item from a source on a UTC day.",
  }
) {}
