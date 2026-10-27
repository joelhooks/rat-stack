import {
  FlagJournal,
  flagPartition,
  validateFlagScope,
} from "@rat-stack/core/flag-control";
import type { FlagPosition } from "@rat-stack/core/flag-control";
import {
  FlagStateStore,
  flagLedgerEngine,
} from "@rat-stack/core/flag-ledger-engine";
import { Flags, decodeFlag, InvalidFlagValue } from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import { Effect, Layer, Option, Ref, Schema } from "effect";

import { evaluateFlag, FlagRule } from "./evaluate.js";

export const memoryFlagsLayer = (
  registry: readonly Flag<unknown>[],
  rules: ReadonlyMap<string, readonly (typeof FlagRule.Type)[]> = new Map()
) =>
  Layer.unwrap(
    Effect.gen(function* makeMemoryFlags() {
      const entries = yield* Effect.forEach([...rules], ([name, values]) =>
        Schema.decodeEffect(Schema.Array(FlagRule))(values).pipe(
          Effect.map((decoded) => [name, decoded] as const)
        )
      );

      const snapshot = new Map(entries);

      const positions = yield* Ref.make<
        ReadonlyMap<string, typeof FlagPosition.Type>
      >(new Map());

      const state = Layer.succeed(FlagStateStore, {
        load: (key) =>
          Ref.get(positions).pipe(
            Effect.map((current) => Option.fromUndefinedOr(current.get(key)))
          ),
        save: (key, position) =>
          Ref.update(
            positions,
            (current) => new Map([...current, [key, position]])
          ),
      });

      const readers = Layer.succeed(Flags, {
        get: (flag, context) =>
          Effect.gen(function* evaluateMemoryFlag() {
            const scope = yield* validateFlagScope(flag, context.scope);
            const current = yield* Ref.get(positions);
            const position = current.get(flagPartition(flag.name, scope));

            if (position !== undefined) {
              return yield* Schema.decodeUnknownEffect(flag.schema)(
                position.value
              ).pipe(
                Effect.mapError(
                  () =>
                    new InvalidFlagValue({
                      flag: flag.name,
                      repair:
                        "Repair the stored value using the flag's declared JSON encoding.",
                    })
                )
              );
            }

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

      return Layer.mergeAll(
        readers,
        flagLedgerEngine.pipe(Layer.provide(Layer.merge(readers, state))),
        FlagJournal.memory
      );
    })
  );
