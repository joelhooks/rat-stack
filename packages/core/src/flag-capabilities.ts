import { implement } from "@rat-stack/capability/implement";
import { Effect, Schema } from "effect";

import { getFlagContract, listFlagsContract } from "./flag-contracts.js";
import { Flags, InvalidFlagValue, UnknownFlag } from "./flags.js";

export { getFlagContract, listFlagsContract } from "./flag-contracts.js";

export const listFlags = implement(listFlagsContract, () =>
  Flags.use((flags) =>
    Effect.succeed(
      flags.registry.map(({ name, owner, removeBy }) => ({
        name,
        owner,
        removeBy,
      }))
    )
  )
);

export const getFlag = implement(getFlagContract, ({ name, context }) =>
  Effect.gen(function* getDeclaredFlag() {
    const flags = yield* Flags;
    const flag = flags.registry.find((entry) => entry.name === name);

    if (flag === undefined) {
      return yield* new UnknownFlag({
        name,
        repair: "Choose a name returned by listFlags.",
      });
    }

    const value = yield* flags.get(flag, context);

    const encoded = yield* Schema.encodeEffect(flag.schema)(value).pipe(
      Effect.mapError(
        () =>
          new InvalidFlagValue({
            name,
            repair: "Use a flag schema with a JSON encoding for getFlag.",
          })
      )
    );

    return yield* Schema.decodeUnknownEffect(Schema.Json)(encoded).pipe(
      Effect.mapError(
        () =>
          new InvalidFlagValue({
            name,
            repair: "Use a flag schema with a JSON encoding for getFlag.",
          })
      )
    );
  })
);

export const flagCapabilities = [listFlags, getFlag] as const;
