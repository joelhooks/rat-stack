import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Random } from "alchemy/Random";
import * as RuntimeContext from "alchemy/RuntimeContext";
import { Effect, Layer, Redacted, Schema } from "effect";

import { EventSinkError } from "./event-sink-error.js";
import { EventSink } from "./event-sink.js";
import { RawEventSchema } from "./schemas.js";
import { VisitorSalt } from "./visitor-salt.js";

export interface BasinOptions {
  readonly id: string;
}

export const EVENTS_TABLE = "events_raw";

const encodeRawEvent = Schema.encodeEffect(RawEventSchema);

export const basinFoundation = ({ id }: BasinOptions) =>
  Effect.gen(function* declareBasinFoundation() {
    const bucket = yield* Cloudflare.R2.Bucket(`${id}EventsBucket`, {});

    const stream = yield* Cloudflare.Pipelines.Stream(`${id}EventsStream`, {
      http: { enabled: false },
    });

    const salt = yield* Random(`${id}VisitorSalt`);

    return { bucket, salt, stream } as const;
  });

export const Basin = ({ id }: BasinOptions) =>
  Layer.unwrap(
    Effect.gen(function* buildBasinEvents() {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const { bucket, salt, stream } = yield* basinFoundation({ id });

      const token = yield* Cloudflare.ApiToken.AccountApiToken(
        `${id}EventsCatalogToken`,
        {
          accountId,
          policies: [
            {
              effect: "allow",
              permissionGroups: [
                "Workers R2 Data Catalog Write",
                "Workers R2 Storage Write",
              ],
              resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
            },
          ],
        }
      );

      const catalog = yield* Cloudflare.R2.DataCatalog(`${id}EventsCatalog`, {
        bucketName: bucket.bucketName,
        token: token.value,
      });

      const sink = yield* Cloudflare.Pipelines.Sink(`${id}EventsSink`, {
        config: {
          bucket: catalog.bucketName,
          namespace: "default",
          tableName: EVENTS_TABLE,
          token: token.value,
        },
        type: "r2_data_catalog",
      });

      yield* Cloudflare.Pipelines.Pipeline(`${id}EventsPipeline`, {
        sql: Output.interpolate`INSERT INTO ${sink.name} SELECT * FROM ${stream.name}`,
      });

      const saltValue = yield* salt.text;
      const writer = yield* Cloudflare.Pipelines.WriteStream(stream);

      return Layer.mergeAll(
        Layer.succeed(EventSink, {
          send: (events) =>
            Effect.all(events.map((event) => encodeRawEvent(event))).pipe(
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
