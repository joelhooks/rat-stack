import { Flags, decodeFlag } from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import { Config, Effect, Layer, Schema } from "effect";

export const configFlagsLayer = (registry: readonly Flag<unknown>[]) =>
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
        get: (flag) =>
          decodeFlag(flag)(
            values.has(flag.name) ? values.get(flag.name) : flag.default
          ),
        registry,
      });
    })
  );
