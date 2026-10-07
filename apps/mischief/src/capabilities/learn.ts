import { LearnError } from "@rat-stack/core/learn";
import { Learner } from "@rat-stack/learn";
import { Effect, Layer } from "effect";

import { ContentStore } from "../content-store.js";

export { learnCapabilities } from "@rat-stack/learn";

export const learnLayer = Layer.unwrap(
  ContentStore.pipe(
    Effect.map((store) =>
      Learner.layer(
        store.learnDeck.pipe(
          Effect.mapError(
            () =>
              new LearnError({
                id: "deck",
                reason:
                  "Unable to read the public deck; retry after content assets recover.",
              })
          )
        )
      )
    )
  )
);
