import {
  captureCrashes,
  InvalidCrashTrace,
  TraceSchema,
} from "@rat-stack/events/crash";
import { R2CrashArchive } from "@rat-stack/events/crash-r2";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Schema } from "effect";

import { silentObservability } from "./observability.js";

export default class CrashTail extends Cloudflare.Worker<CrashTail>()(
  "MischiefCrashTail",
  {
    compatibility: { date: "2026-05-28" },
    main: import.meta.url,
    observability: silentObservability,
    workersDev: false,
  },
  Effect.gen(function* makeCrashTail() {
    const archive = yield* Layer.build(R2CrashArchive);

    return {
      tail: (events: readonly unknown[]) =>
        Schema.decodeUnknownEffect(Schema.Array(TraceSchema))(events).pipe(
          Effect.mapError(() => new InvalidCrashTrace()),
          Effect.flatMap((traces) => captureCrashes(traces)),
          Effect.provide(archive)
        ),
    };
  })
) {}
