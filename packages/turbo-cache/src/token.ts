import { Effect, Option, Redacted, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { tokenId, turboCacheConfig } from "./config.js";

const TokenRecord = Schema.Struct({
  attr: Schema.Struct({ text: Schema.Redacted(Schema.NonEmptyString) }),
  resourceType: Schema.Literal("Alchemy.Random"),
  status: Schema.Literals(["created", "updated"]),
});

const WorkerRecord = Schema.Struct({
  attr: Schema.Struct({ url: Schema.NonEmptyString }),
  status: Schema.Literals(["created", "updated"]),
});

export class TokenHandoffError extends Schema.TaggedError<TokenHandoffError>()(
  "TokenHandoffError",
  {
    message: Schema.String,
  }
) {}

export interface TokenHandoffOptions {
  readonly team: string;
  readonly command: string;
  readonly args: readonly string[];
}

export const handoffToken = Effect.fn("TurboCache.handoffToken")(
  function* handoffToken(
    read: (fqn: string) => Effect.Effect<unknown, TokenHandoffError>,
    options: TokenHandoffOptions
  ) {
    if (
      !turboCacheConfig.teams.some((team) => team === options.team) ||
      options.command.length === 0
    ) {
      return yield* new TokenHandoffError({
        message:
          "The team or receiving command is missing. Fix: use a team in `packages/turbo-cache/src/config.ts` and pass `-- <command>` to `pnpm turbo-cache:token`.",
      });
    }

    const tokenRecord = Schema.decodeUnknownOption(TokenRecord)(
      yield* read(`TurboCacheFoundation/${tokenId(options.team)}`)
    );

    const workerRecord = Schema.decodeUnknownOption(WorkerRecord)(
      yield* read("TurboCache")
    );

    if (Option.isNone(tokenRecord) || Option.isNone(workerRecord)) {
      return yield* new TokenHandoffError({
        message:
          "The cache has no completed deployment in state. A missing token cannot be regenerated during handoff. Fix: deploy the cartridge through the approved Stack workflow, then retry `pnpm turbo-cache:token`.",
      });
    }

    const origin = yield* Effect.try({
      catch: () =>
        new TokenHandoffError({
          message:
            "The deployed cache URL is invalid. Fix: inspect the `TurboCache` resource through the approved state workflow.",
        }),
      try: () => new URL(workerRecord.value.attr.url).origin,
    });

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const token = tokenRecord.value.attr.text;

    const code = yield* spawner
      .exitCode(
        ChildProcess.make(options.command, [...options.args], {
          stderr: "ignore",
          stdin: Stream.sync(() =>
            new TextEncoder().encode(Redacted.value(token))
          ),
          stdout: "ignore",
        })
      )
      .pipe(
        Effect.mapError(
          () =>
            new TokenHandoffError({
              message:
                "The credential receiver could not run. Its output is suppressed to prevent credential disclosure. Fix: verify the receiving command passed to `pnpm turbo-cache:token`.",
            })
        )
      );

    if (code !== 0) {
      return yield* new TokenHandoffError({
        message:
          "The credential receiver failed. Its output is suppressed to prevent credential disclosure. Fix: verify the receiving command passed to `pnpm turbo-cache:token`.",
      });
    }

    return { TURBO_API: origin, TURBO_TEAM: options.team };
  }
);
