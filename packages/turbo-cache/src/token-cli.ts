import { NodeRuntime } from "@effect/platform-node";
import * as Alchemist from "alchemy/Alchemist";
import { Console, Effect } from "effect";

import { turboCacheConfig } from "./config.js";
import { deployedCacheState } from "./read-state.js";
import { stateReadFailure } from "./token-failure.js";
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
    Effect.catchCause((cause) => Effect.fail(stateReadFailure(cause)))
  );

  const values = yield* handoffToken(
    (fqn) =>
      store
        .get({ fqn, stack: turboCacheConfig.stack, stage })
        .pipe(
          Effect.catchCause((cause) => Effect.fail(stateReadFailure(cause)))
        ),
    { args: args.slice(separator + 2), command, team }
  );

  yield* Console.log(
    `TURBO_API=${values.TURBO_API}\nTURBO_TEAM=${values.TURBO_TEAM}`
  );

  return values;
}).pipe(Effect.scoped, Effect.provide(Alchemist.layer()));

NodeRuntime.runMain(main);
