import { flagControlDefaults } from "@rat-stack/core/flag-control";
import { Flags, decodeFlag, validateFlagScope } from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import { Config, Effect, Layer, Schema } from "effect";

export const configFlagsLayer = (registry: readonly Flag<unknown>[]) =>
  Layer.merge(
    flagControlDefaults,
    Layer.effect(
      Flags,
      Effect.gen(function* readFlagConfig() {
        const entries = yield* Effect.forEach((flag: Flag<unknown>) =>
          (flag.schema === Schema.Boolean
            ? Config.Boolean(flag.name)
            : Config.schema(flag.schema, flag.name)
          ).pipe(
            Config.withDefault(flag.default),
            Effect.map((value) => [flag.name, value] as const)
          )
        )(registry);

        const values = new Map(entries);

        return Flags.of({
          get: (flag, context) =>
            validateFlagScope(flag, context.scope).pipe(
              Effect.andThen(
                decodeFlag(flag)(
                  values.has(flag.name) ? values.get(flag.name) : flag.default
                )
              )
            ),
          registry,
        });
      })
    )
  );
