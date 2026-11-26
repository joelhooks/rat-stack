import { HtmlHydrate } from "@effect/ui/html";
import { Effect, Option, Schema } from "effect";

import { NewsPage } from "./component.js";
import { NewsHandoff, newsHandoffId, newsRootId } from "./model.js";

const decodeHandoff = Schema.decodeEffect(Schema.fromJsonString(NewsHandoff));

const adoptNews = Effect.fn("news.adopt")(function* adoptNews(
  container: HTMLDivElement,
  { props, state }: typeof NewsHandoff.Type
) {
  const root = yield* HtmlHydrate.hydrateEffect(
    NewsPage,
    props,
    container,
    state
  );

  yield* root.adopted;

  container.dataset.hydrated = "true";

  return yield* Effect.never;
});

export const hydrateNews = (page: Document) =>
  Effect.suspend(() => {
    const container = page.querySelector(`#${newsRootId}`);
    const payload = page.querySelector(`#${newsHandoffId}`);

    if (!(container instanceof HTMLDivElement) || payload === null) {
      return Effect.void;
    }

    return decodeHandoff(payload.textContent ?? "").pipe(
      Effect.option,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (handoff) => adoptNews(container, handoff),
        })
      )
    );
  });
