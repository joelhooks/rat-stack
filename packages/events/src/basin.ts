import * as Cloudflare from "@alchemy.run/cloudflare";
import { basinStream, icebergSink } from "@rat-stack/basin";
import "alchemy/Phase";
import { Random } from "alchemy/Random";
import { retain } from "alchemy/RemovalPolicy";
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

export const unstructuredRow = (event: typeof RawEventSchema.Type) =>
  encodeRawEvent(event).pipe(Effect.map((value) => ({ value })));

export const basinFoundation = ({ id }: BasinOptions) =>
  Effect.gen(function* declareBasinFoundation() {
    const { bucket, stream } = yield* basinStream(`${id}Events`);
    const salt = yield* Random(`${id}VisitorSalt`).pipe(retain());

    return { bucket, salt, stream } as const;
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
            Effect.forEach((event: (typeof events)[number]) =>
              unstructuredRow(event)
            )(events).pipe(
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
