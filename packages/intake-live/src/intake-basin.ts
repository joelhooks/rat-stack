import { IntakeEvents, IntakeEventsUnavailable } from "@rat-stack/core/intake";
import { basinStream, icebergSink } from "@rat-stack/events/basin";
import type { CatalogMaintenance } from "@rat-stack/events/basin";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RuntimeContext from "alchemy/RuntimeContext";
import { Effect, Layer } from "effect";

import { IntakeBackfill, basinIntakeEvents } from "./basin-intake-events.js";
import { INTAKE_TABLE } from "./intake-rows.js";

export { IntakeBackfill } from "./basin-intake-events.js";

export interface IntakeBasinOptions {
  readonly name: string;
}

export const INTAKE_CATALOG_MAINTENANCE: CatalogMaintenance = {
  compaction: { state: "enabled", targetSizeMb: "64" },
  snapshotExpiration: {
    maxSnapshotAge: "7d",
    minSnapshotsToKeep: 1,
    state: "enabled",
  },
};

export const IntakeBasin = ({ name }: IntakeBasinOptions) =>
  Layer.unwrap(
    Effect.gen(function* buildIntakeBasin() {
      const { bucket, stream } = yield* basinStream(name);

      if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
        yield* icebergSink({
          bucketName: bucket.bucketName,
          maintenance: INTAKE_CATALOG_MAINTENANCE,
          name,
          streamName: stream.name,
          table: INTAKE_TABLE,
        });
      }

      const writer = yield* Cloudflare.Pipelines.WriteStream(stream);

      const { backfill, events } = basinIntakeEvents({
        send: (rows) =>
          writer.send(rows).pipe(
            Effect.mapError(() => new IntakeEventsUnavailable({})),
            Effect.provide(RuntimeContext.RuntimeContext.phantom)
          ),
      });

      return Layer.mergeAll(
        Layer.succeed(IntakeEvents, events),
        Layer.succeed(IntakeBackfill, backfill)
      );
    })
  ).pipe(Layer.provide(Cloudflare.Pipelines.WriteStreamBinding));
