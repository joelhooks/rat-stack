import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import * as RuntimeContext from "alchemy/RuntimeContext";
import { DateTime, Effect, Layer, Schema } from "effect";

import {
  CrashArchive,
  CrashArchiveError,
  CrashRecordSchema,
  InvalidCrashTrace,
} from "./crash.js";
import { webCrypto } from "./web-crypto.js";

export const CrashBucket = Cloudflare.R2.Bucket("MischiefCrashBucket", {}).pipe(
  retain()
);

export const crashArchiveLayer = <E, IdError>(
  write: (key: string, body: string) => Effect.Effect<unknown, E>,
  freshId: Effect.Effect<string, IdError>
) =>
  Layer.succeed(CrashArchive, {
    record: Effect.fn("CrashArchive.record")(function* recordCrash(input) {
      const record = yield* Schema.decodeUnknownEffect(CrashRecordSchema)(
        input
      ).pipe(Effect.mapError(() => new InvalidCrashTrace()));

      const instant =
        record.eventTime === null
          ? yield* DateTime.now
          : DateTime.makeUnsafe(record.eventTime);

      const day = DateTime.formatIsoDate(instant);

      const id = yield* freshId.pipe(
        Effect.mapError(() => new CrashArchiveError())
      );

      yield* write(`crashes/${day}/${id}.json`, JSON.stringify(record)).pipe(
        Effect.mapError(() => new CrashArchiveError())
      );
    }),
  });

export const R2CrashArchive = Layer.unwrap(
  Effect.gen(function* buildCrashArchive() {
    const bucket = yield* CrashBucket;
    const writer = yield* Cloudflare.R2.WriteBucket(bucket);

    return crashArchiveLayer(
      (key, body) =>
        writer
          .put(key, body, {
            httpMetadata: { contentType: "application/json" },
          })
          .pipe(Effect.provide(RuntimeContext.RuntimeContext.phantom)),
      webCrypto.randomUUIDv4
    );
  })
).pipe(Layer.provide(Cloudflare.R2.WriteBucketBinding));
