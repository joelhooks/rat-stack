import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import * as RuntimeContext from "alchemy/RuntimeContext";
import {
  Config,
  ConfigProvider,
  Effect,
  Layer,
  Redacted,
  Schema,
} from "effect";

import { EventSinkError } from "./event-sink-error.js";
import { EventSink } from "./event-sink.js";
import { RawEventSchema } from "./schemas.js";
import { VisitorSalt } from "./visitor-salt.js";

export interface BasinOptions {
  readonly id: string;
}

export const EVENTS_TABLE = "events_raw";

const encodeRawEvent = Schema.encodeEffect(RawEventSchema);

export const unstructuredRow = (event: typeof RawEventSchema.Type) =>
  encodeRawEvent(event).pipe(Effect.map((value) => ({ value })));

export const basinStream = (name: string) =>
  Effect.gen(function* declareBasinStream() {
    const bucket = yield* Cloudflare.R2.Bucket(`${name}Bucket`, {});

    const stream = yield* Cloudflare.Pipelines.Stream(`${name}Stream`, {
      http: { enabled: false },
    });

    return { bucket, stream } as const;
  });

export const basinFoundation = ({ id }: BasinOptions) =>
  Effect.gen(function* declareBasinFoundation() {
    const { bucket, stream } = yield* basinStream(`${id}Events`);
    const salt = yield* Random(`${id}VisitorSalt`);

    return { bucket, salt, stream } as const;
  });

const sinkToken = Config.Redacted("EVENTS_SINK_TOKEN").pipe(
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())
);

export type CatalogMaintenance = Pick<
  Cloudflare.R2.DataCatalogProps,
  "compaction" | "snapshotExpiration"
>;

export interface IcebergSinkOptions {
  readonly bucketName: Output.Output<string>;
  readonly maintenance?: CatalogMaintenance;
  readonly name: string;
  readonly streamName: Output.Output<string>;
  readonly table: string;
}

export const icebergSink = ({
  bucketName,
  maintenance = {},
  name,
  streamName,
  table,
}: IcebergSinkOptions) =>
  Effect.gen(function* declareIcebergSink() {
    const token = yield* sinkToken;

    const catalog = yield* Cloudflare.R2.DataCatalog(`${name}Catalog`, {
      ...maintenance,
      bucketName,
      token,
    });

    const sink = yield* Cloudflare.Pipelines.Sink(`${name}Sink`, {
      config: {
        bucket: catalog.bucketName,
        namespace: "default",
        tableName: table,
        token,
      },
      format: { compression: "zstd", type: "parquet" },
      type: "r2_data_catalog",
    });

    return yield* Cloudflare.Pipelines.Pipeline(`${name}Pipeline`, {
      sql: Output.interpolate`INSERT INTO ${sink.name} SELECT * FROM ${streamName}`,
    });
  });

export const Basin = ({ id }: BasinOptions) =>
  Layer.unwrap(
    Effect.gen(function* buildBasinEvents() {
      const { bucket, salt, stream } = yield* basinFoundation({ id });

      if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
        yield* icebergSink({
          bucketName: bucket.bucketName,
          name: `${id}Events`,
          streamName: stream.name,
          table: EVENTS_TABLE,
        });
      }

      const saltValue = yield* salt.text;
      const writer = yield* Cloudflare.Pipelines.WriteStream(stream);

      return Layer.mergeAll(
        Layer.succeed(EventSink, {
          send: (events) =>
            Effect.all(events.map((event) => unstructuredRow(event))).pipe(
              Effect.flatMap((records) => writer.send(records)),
              Effect.mapError((cause) => new EventSinkError({ cause })),
              Effect.provide(RuntimeContext.RuntimeContext.phantom)
            ),
        }),
        Layer.succeed(VisitorSalt, {
          salt: saltValue.pipe(Effect.map((secret) => Redacted.value(secret))),
        })
      );
    })
  ).pipe(Layer.provide(Cloudflare.Pipelines.WriteStreamBinding));
