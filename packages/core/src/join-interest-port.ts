import { Context, Effect } from "effect";

import { JOIN_NOT_OPEN } from "./join-interest-contract.js";
import type { JoinInput, JoinOutput } from "./join-interest-contract.js";

export const newStatusRef = Effect.sync(() =>
  // @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off -- Web Crypto is available in both Worker and Node composition roots.
  crypto.randomUUID()
);

export const JoinInterest = Context.Reference<{
  readonly submit: (input: JoinInput) => Effect.Effect<JoinOutput>;
}>("@rat-stack/core/JoinInterest", {
  defaultValue: () => ({
    submit: (_input: JoinInput): Effect.Effect<JoinOutput> =>
      newStatusRef.pipe(
        Effect.map((statusRef) => ({ message: JOIN_NOT_OPEN, statusRef }))
      ),
  }),
});
