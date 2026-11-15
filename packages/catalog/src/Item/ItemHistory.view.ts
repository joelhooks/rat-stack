import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Operator } from "../Operator.context.ts";
import { OperatorToken } from "../Operator.middleware.ts";
import { ItemDropped } from "./Drop.command.ts";
import { Item } from "./Item.aggregate.ts";
import { ItemKept } from "./Keep.command.ts";
import { SightingRecorded } from "./RecordSighting.command.ts";
import { Sighting } from "./Sighting.ts";

const HistoryState = Schema.Struct({
  sightings: Schema.Natural,
  latestSighting: Schema.NullOr(Sighting),
  decision: Schema.Literals(["undecided", "kept", "dropped"]),
  why: Schema.NullOr(Schema.String),
});

export class ItemHistory extends Domain.View(
  "ItemHistory",
  {
    from: [Item],
    key: Item,
    middleware: [OperatorToken],
    state: HistoryState,
    initial: {
      sightings: 0,
      latestSighting: null,
      decision: "undecided",
      why: null,
    },
    events: [SightingRecorded, ItemKept, ItemDropped],
    emit: {
      SightingRecorded: (event) => event,
      ItemKept: (event) => event,
      ItemDropped: (event) => event,
    },
    evolve: {
      SightingRecorded: (state, event) => ({
        ...state,
        sightings: state.sightings + 1,
        latestSighting: event,
      }),
      ItemKept: (state, event): typeof HistoryState.Type => ({
        ...state,
        decision: "kept",
        why: event.why,
      }),
      ItemDropped: (state, event): typeof HistoryState.Type => ({
        ...state,
        decision: "dropped",
        why: event.why,
      }),
    },
  },
  {
    description:
      "Operator-only summary and cursor-paged observations and decisions for one item.",
  }
) {}

export const ItemHistoryLive = ItemHistory.toLayer(
  Effect.succeed(
    Effect.fn(function* ItemHistoryLive() {
      yield* Operator;
    })
  )
);
