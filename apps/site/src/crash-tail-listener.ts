import {
  captureCrashes,
  CrashArchive,
  InvalidCrashTrace,
  TraceSchema,
} from "@rat-stack/events/crash";
import * as Cloudflare from "alchemy/Cloudflare";
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
            Effect.mapError(() => new InvalidCrashTrace()),
            Effect.flatMap((traces) => captureCrashes(traces)),
            Effect.provideService(CrashArchive, archive),
            Effect.orDie
          )
        : undefined
    );
  }
);
