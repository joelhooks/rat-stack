import { HtmlHydrate } from "@effect/ui/html";
import { Cause, Effect, Schema } from "effect";

import { AllStarsPage } from "./component.js";
import { AllStarsHandoff, allStarsHandoffId, allStarsRootId } from "./model.js";

const decodeHandoff = Schema.decodeEffect(
  Schema.fromJsonString(AllStarsHandoff)
);

export const hydrateAllStars = (page: Document) =>
  Effect.suspend(() => {
    const container = page.querySelector<HTMLDivElement>(`#${allStarsRootId}`);
    const payload = page.querySelector(`#${allStarsHandoffId}`);

    if (container === null || payload === null) {
      return Effect.void;
    }

    return decodeHandoff(payload.textContent ?? "").pipe(
      Effect.flatMap(({ props, state }) =>
        Effect.gen(function* adoptAllStars() {
          const root = yield* HtmlHydrate.hydrateEffect(
            AllStarsPage,
            props,
            container,
            state
          );

          yield* root.adopted;
          container.dataset.hydrated = "true";

          return yield* Effect.never;
        })
      )
    );
  }).pipe(
    Effect.scoped,
    Effect.tapCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.void;
      }

      if (Cause.hasFails(cause)) {
        return Effect.logError("All Stars hydration failed: invalid handoff");
      }

      return Effect.logError("All Stars hydration failed", cause);
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.void
    )
  );
