import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import { retain } from "alchemy/RemovalPolicy";
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

export const basinFoundation = ({ id }: BasinOptions) =>
  Effect.gen(function* declareBasinFoundation() {
    const bucket = yield* Cloudflare.R2.Bucket(`${id}EventsBucket`, {}).pipe(
      retain()
    );

    const stream = yield* Cloudflare.Pipelines.Stream(`${id}EventsStream`, {
      http: { enabled: false },
    }).pipe(retain());

    const salt = yield* Random(`${id}VisitorSalt`).pipe(retain());

    return { bucket, salt, stream } as const;
  });

const sinkToken = Config.Redacted("EVENTS_SINK_TOKEN").pipe(
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())
);

export interface IcebergSinkOptions extends BasinOptions {
  readonly bucketName: Output.Output<string>;
  readonly streamName: Output.Output<string>;
}

export const icebergSink = ({
  bucketName,
  id,
  streamName,
}: IcebergSinkOptions) =>
  Effect.gen(function* declareIcebergSink() {
    const token = yield* sinkToken;

    const catalog = yield* Cloudflare.R2.DataCatalog(`${id}EventsCatalog`, {
      bucketName,
      token,
    }).pipe(retain());

    const sink = yield* Cloudflare.Pipelines.Sink(`${id}EventsSink`, {
      config: {
        bucket: catalog.bucketName,
        namespace: "default",
        tableName: EVENTS_TABLE,
        token,
      },
      format: { compression: "zstd", type: "parquet" },
      type: "r2_data_catalog",
    }).pipe(retain());

    return yield* Cloudflare.Pipelines.Pipeline(`${id}EventsPipeline`, {
      sql: Output.interpolate`INSERT INTO ${sink.name} SELECT * FROM ${streamName}`,
    }).pipe(retain());
  });

export const Basin = ({ id }: BasinOptions) =>
  Layer.unwrap(
    Effect.gen(function* buildBasinEvents() {
      const { bucket, salt, stream } = yield* basinFoundation({ id });

      if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
        yield* icebergSink({
          bucketName: bucket.bucketName,
          id,
          streamName: stream.name,
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
