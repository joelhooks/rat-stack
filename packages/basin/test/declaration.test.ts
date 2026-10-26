import * as Cloudflare from "@alchemy.run/cloudflare";
import { expect, it } from "@effect/vitest";
import { Stack, Stage } from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { collection } from "alchemy/Provider";
import { inMemoryState } from "alchemy/State";
import { Effect, Layer, Schema } from "effect";
import { afterAll, vi } from "vitest";

vi.stubEnv("EVENTS_SINK_TOKEN", "basin-declaration-test");

const { basinStream, icebergSink } = await import("../src/index.js");

const Name = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9]{0,12}$/u)
);

afterAll(() => vi.unstubAllEnvs());

it.effect.prop(
  "each Basin keeps its stream private, retains storage, and isolates its table and maintenance policy",
  { name: Name, table: Name },
  ({ name, table }) =>
    Stack(
      "BasinDeclaration",
      {
        providers: Layer.effect(Cloudflare.Providers, collection([])),
        state: inMemoryState(),
      },
      Effect.gen(function* declareBasin() {
        const { bucket, stream } = yield* basinStream(name);

        yield* icebergSink({
          bucketName: bucket.bucketName,
          maintenance: {
            compaction: { state: "enabled", targetSizeMb: "64" },
          },
          name,
          streamName: stream.name,
          table,
        });
      })
    ).pipe(
      Effect.tap((stack) =>
        Effect.sync(() => {
          expect(Object.keys(stack.resources).toSorted()).toEqual(
            ["Bucket", "Catalog", "Pipeline", "Sink", "Stream"].map(
              (suffix) => `${name}${suffix}`
            )
          );
          expect(stack.resources[`${name}Stream`]?.Props).toMatchObject({
            http: { enabled: false },
          });
          expect(stack.resources[`${name}Catalog`]?.Props).toMatchObject({
            compaction: { state: "enabled", targetSizeMb: "64" },
          });
          expect(stack.resources[`${name}Sink`]?.Props).toMatchObject({
            config: { namespace: "default", tableName: table },
            format: { compression: "zstd", type: "parquet" },
            type: "r2_data_catalog",
          });

          for (const resource of Object.values(stack.resources)) {
            expect(resource.RemovalPolicy).toBe("retain");
          }
        })
      ),
      Effect.provideService(Stage, "test"),
      Effect.provideService(AlchemyContext, {
        adopt: false,
        dev: false,
        dotAlchemy: ".alchemy",
      }),
      Effect.scoped,
      Effect.asVoid
    )
);
