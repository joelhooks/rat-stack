import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { Drop, ItemDropped } from "./Drop.command.ts";
import { ItemId } from "./Item.id.ts";
import { ItemKept, Keep } from "./Keep.command.ts";
import {
  KindMismatch,
  RecordSighting,
  SightingRecorded,
} from "./RecordSighting.command.ts";
import { ItemKind } from "./Sighting.ts";
import { UnseenItem } from "./UnseenItem.rejection.ts";

const ItemState = Schema.Struct({
  kind: Schema.NullOr(ItemKind),
  sightingKeys: Schema.Array(Schema.String),
  decision: Schema.Literals(["undecided", "kept", "dropped"]),
});

export class Item extends Domain.Aggregate(
  "Item",
  {
    id: ItemId,
    state: ItemState,
    initial: { kind: null, sightingKeys: [], decision: "undecided" },
    commands: [RecordSighting, Keep, Drop],
    decide: {
      RecordSighting: (state, command) => {
        if (state.kind !== null && state.kind !== command.kind) {
          return new KindMismatch({
            recorded: state.kind,
            requested: command.kind,
          });
        }

        const sightingKey = `${command.source.length}:${command.source}:${DateTime.formatIsoDateUtc(command.observedAt)}`;

        return state.sightingKeys.includes(sightingKey)
          ? []
          : [
              new SightingRecorded({
                kind: command.kind,
                source: command.source,
                observedAt: command.observedAt,
                metrics: command.metrics,
                author: command.author?.toLowerCase(),
                sightingKey,
              }),
            ];
      },
      Keep: (state, command) => {
        if (state.kind === null) {
          return new UnseenItem();
        }

        return state.decision === "kept"
          ? []
          : [new ItemKept({ why: command.why })];
      },
      Drop: (state, command) => {
        if (state.kind === null) {
          return new UnseenItem();
        }

        return state.decision === "dropped"
          ? []
          : [new ItemDropped({ why: command.why })];
      },
    },
    evolve: {
      SightingRecorded: (state, event) => ({
        ...state,
        kind: event.kind,
        sightingKeys: [...state.sightingKeys, event.sightingKey],
      }),
      ItemKept: (state): typeof ItemState.Type => ({
        ...state,
        decision: "kept",
      }),
      ItemDropped: (state): typeof ItemState.Type => ({
        ...state,
        decision: "dropped",
      }),
    },
  },
  {
    description:
      "One canonical URL's observations and editorial decisions, committed atomically.",
  }
) {}
