import { NodeRuntime } from "@effect/platform-node";
import * as Alchemist from "alchemy/Alchemist";
import { Console, Effect } from "effect";

import { turboCacheConfig } from "./config.js";
import { deployedCacheState } from "./read-state.js";
import { handoffToken, TokenHandoffError } from "./token.js";

const main = Effect.gen(function* tokenMain() {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const flags = args.slice(0, separator);
  const teamIndex = flags.indexOf("--team");
  const stageIndex = flags.indexOf("--stage");
  const team = teamIndex === -1 ? undefined : flags[teamIndex + 1];
  const stage = stageIndex === -1 ? "prod" : flags[stageIndex + 1];
  const command = args[separator + 1];

  if (
    separator === -1 ||
    team === undefined ||
    stage === undefined ||
    command === undefined ||
    flags.length !== (stageIndex === -1 ? 2 : 4)
  ) {
    return yield* new TokenHandoffError({
      message:
        "The token handoff needs a team and a command. Fix: run `pnpm turbo-cache:token --team <slug> --stage <stage> -- <command> [args]`.",
    });
  }

  const store = yield* deployedCacheState.pipe(
    Effect.catchCause(() =>
      Effect.fail(
        new TokenHandoffError({
          message:
            "The deployed state store is unavailable or requires an upgrade. No credential was sent and provisioning is disabled. Fix: verify the Alchemy profile and configured state store; use the approved deployment workflow for any bootstrap or upgrade.",
        })
      )
    )
  );

  const values = yield* handoffToken(
    (fqn) =>
      store.get({ fqn, stack: turboCacheConfig.stack, stage }).pipe(
        Effect.mapError(
          () =>
            new TokenHandoffError({
              message:
                "The deployed state record could not be read. No credential was sent. Fix: verify the configured Alchemy state store and stage.",
            })
        )
      ),
    { args: args.slice(separator + 2), command, team }
  );

  yield* Console.log(
    `TURBO_API=${values.TURBO_API}\nTURBO_TEAM=${values.TURBO_TEAM}`
  );

  return values;
}).pipe(Effect.scoped, Effect.provide(Alchemist.layer()));

NodeRuntime.runMain(main);
