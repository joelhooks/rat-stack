import { HtmlHydrate } from "@effect/ui/html";
import { Cause, Effect, Schema } from "effect";

import { DirectoryPage } from "./component.js";
import {
  DirectoryHandoff,
  directoryHandoffId,
  directoryRootId,
} from "./model.js";

const decodeHandoff = Schema.decodeEffect(
  Schema.fromJsonString(DirectoryHandoff)
);

export const hydrateDirectory = (page: Document) =>
  Effect.suspend(() => {
    const container = page.querySelector<HTMLDivElement>(`#${directoryRootId}`);
    const payload = page.querySelector(`#${directoryHandoffId}`);

    if (container === null || payload === null) {
      return Effect.void;
    }

    return decodeHandoff(payload.textContent ?? "").pipe(
      Effect.flatMap(({ props, state }) =>
        Effect.gen(function* adoptDirectory() {
          const root = yield* HtmlHydrate.hydrateEffect(
            DirectoryPage,
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
        return Effect.logError("Directory hydration failed: invalid handoff");
      }

      return Effect.logError("Directory hydration failed", cause);
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.void
    )
  );
