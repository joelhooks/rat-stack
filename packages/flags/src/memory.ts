import { Flags, decodeFlag } from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import { Effect, Layer, Schema } from "effect";

import { evaluateFlag, FlagRule } from "./evaluate.js";

export const memoryFlagsLayer = (
  registry: readonly Flag<unknown>[],
  rules: ReadonlyMap<string, readonly (typeof FlagRule.Type)[]> = new Map()
) =>
  Layer.effect(
    Flags,
    Effect.gen(function* makeMemoryFlags() {
      const entries = yield* Effect.forEach([...rules], ([name, values]) =>
        Schema.decodeEffect(Schema.Array(FlagRule))(values).pipe(
          Effect.map((decoded) => [name, decoded] as const)
        )
      );

      const snapshot = new Map(entries);

      return Flags.of({
        get: (flag, context) =>
          Effect.gen(function* evaluateMemoryFlag() {
            const decodedRules = yield* Effect.forEach(
              (rule: typeof FlagRule.Type) =>
                decodeFlag(flag)(rule.value).pipe(
                  Effect.map((value) => ({ ...rule, value }))
                )
            )(snapshot.get(flag.name) ?? []);

            return yield* decodeFlag(flag)(
              evaluateFlag(flag, context, decodedRules)
            );
          }),
        registry,
      });
    })
  );
