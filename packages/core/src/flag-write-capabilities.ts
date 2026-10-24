import { aroundHandlers, implement } from "@rat-stack/capability/implement";
import { Effect, Schema } from "effect";

import { auditFlagRun } from "./flag-audit.js";
import { setFlagContract } from "./flag-contracts.js";
import { FlagWriter } from "./flag-control.js";
import { Flags, InvalidFlagValue, UnknownFlag } from "./flags.js";

const approvedSetFlag = implement(setFlagContract, ({ name, value }) =>
  Effect.gen(function* setDeclaredFlag() {
    const flags = yield* Flags;
    const writer = yield* FlagWriter;
    const flag = flags.registry.find((entry) => entry.name === name);

    if (flag === undefined) {
      return yield* new UnknownFlag({
        name,
        repair: "Choose a name returned by listFlags.",
      });
    }

    const decoded = yield* Schema.decodeEffect(flag.schema)(value).pipe(
      Effect.mapError(
        () =>
          new InvalidFlagValue({
            name,
            repair: `Set ${name} to a value accepted by its declared schema.`,
          })
      )
    );

    return yield* writer.set(flag, decoded);
  })
);

export const [setFlag] = aroundHandlers(
  [approvedSetFlag] as const,
  auditFlagRun
);

export const flagWriteCapabilities = [setFlag] as const;
