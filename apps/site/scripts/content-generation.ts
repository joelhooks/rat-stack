import { Config, Effect, Option } from "effect";

export const generateForCommand = <E, R>(generate: Effect.Effect<void, E, R>) =>
  Effect.gen(function* prepareForCommand() {
    const hash = yield* Config.option(Config.String("TURBO_HASH"));

    if (Option.getOrElse(hash, () => "") === "") {
      yield* generate;
    }
  });
