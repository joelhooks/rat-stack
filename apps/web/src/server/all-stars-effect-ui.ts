import { HtmlServer } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { AllStarsPage } from "../client/all-stars-effect-ui/component.js";
import {
  AllStarsHandoff,
  allStarsHandoffId,
  allStarsRootId,
} from "../client/all-stars-effect-ui/model.js";
import type { AllStarsProps } from "../client/all-stars-effect-ui/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import type { EffectUiAssets } from "./reader-document.js";
import { renderEffectUiCafe } from "./reader-effect-ui.js";

export const renderAllStarsPage = Effect.fn("reader.renderAllStarsPage")(
  function* renderAllStarsPage(
    page: ReaderPageFlags,
    { people }: typeof AllStarsProps.Type,
    assets: typeof EffectUiAssets.Type
  ) {
    const props = { people };
    const rendered = yield* HtmlServer.renderToHtml(AllStarsPage, props);

    const handoff = yield* Schema.encodeEffect(AllStarsHandoff)({
      props,
      state: rendered.state,
    });

    return yield* renderEffectUiCafe(
      page,
      allStarsRootId,
      rendered.html,
      allStarsHandoffId,
      handoff,
      assets
    );
  }
);
