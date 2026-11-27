import { HtmlHydrate } from "@effect/ui/html";
import { Cause, Effect, Schema } from "effect";

import { ReaderPage } from "./component.js";
import { ReaderHandoff, readerHandoffId, readerRootId } from "./model.js";

const decodeHandoff = Schema.decodeEffect(Schema.fromJsonString(ReaderHandoff));

const adoptReader = Effect.fn("reader.adopt")(function* adoptReader(
  container: HTMLDivElement,
  { props, state }: typeof ReaderHandoff.Type
) {
  const root = yield* HtmlHydrate.hydrateEffect(
    ReaderPage,
    props,
    container,
    state
  );

  yield* root.adopted;

  container.dataset.hydrated = "true";

  return yield* Effect.never;
});

export const hydrateReader = (page: Document) =>
  Effect.gen(function* hydrateReaderPage() {
    const container = page.querySelector(`#${readerRootId}`);
    const payload = page.querySelector(`#${readerHandoffId}`);

    if (!(container instanceof HTMLDivElement) || payload === null) {
      return yield* Effect.void;
    }

    const handoff = yield* decodeHandoff(payload.textContent ?? "");

    return yield* adoptReader(container, handoff);
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logError(
            "Reader hydration failed",
            { path: page.location.pathname },
            cause
          )
    )
  );
