import { HtmlHydrate } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { installReaderTools } from "../web-mcp-boot.js";
import { NewsPage } from "./component.js";
import { NewsHandoff, newsHandoffId, newsRootId } from "./model.js";

import "../../../../site/src/rat.css";
import "../reader.css";

const decodeHandoff = Schema.decodeUnknownEffect(
  Schema.fromJsonString(NewsHandoff)
);

const hydrateNews = Effect.gen(function* hydrateNews() {
  const container = document.querySelector(`#${newsRootId}`);
  const payload = document.querySelector(`#${newsHandoffId}`);

  if (!(container instanceof HTMLDivElement) || payload === null) {
    return yield* Effect.die(new Error("Missing Effect UI news handoff"));
  }

  const { props, state } = yield* decodeHandoff(payload.textContent);

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

installReaderTools();

Effect.runFork(
  hydrateNews.pipe(
    Effect.scoped,
    Effect.tapCause((cause) => Effect.logError("News hydration failed", cause))
  )
);
