import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  captureCrashes,
  CrashArchive,
  InvalidCrashTrace,
  TraceSchema,
} from "@rat-stack/crash";
import { Effect, Schema } from "effect";

export const registerCrashTail = Effect.gen(
  function* registerCrashTailListener() {
    const host = yield* Cloudflare.Worker;
    const archive = yield* CrashArchive;

    yield* host.listen((event) =>
      Cloudflare.Workers.isWorkerEvent(event) && event.type === "tail"
        ? Schema.decodeUnknownEffect(Schema.Array(TraceSchema))(
            event.input
          ).pipe(
            // oxlint-disable-next-line anti-slop-effect/require-cause-when-narrowing -- Raw tail validation errors can contain request secrets before crash redaction and must not be logged.
            Effect.mapError(() => new InvalidCrashTrace()),
            Effect.flatMap((traces) => captureCrashes(traces)),
            Effect.provideService(CrashArchive, archive),
            Effect.orDie
          )
        : undefined
    );
  }
);
