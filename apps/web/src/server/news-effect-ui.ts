import { HtmlServer } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { NewsPage } from "../client/news-effect-ui/component.js";
import {
  NewsHandoff,
  newsHandoffId,
  newsRootId,
} from "../client/news-effect-ui/model.js";
import type { NewsPageProps } from "../client/news-effect-ui/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import type { EffectUiAssets } from "./reader-document.js";
import { renderEffectUiCafe } from "./reader-effect-ui.js";

export const renderNewsPage = Effect.fn("reader.renderNewsPage")(
  function* renderNewsPage(
    page: ReaderPageFlags,
    props: NewsPageProps,
    assets: typeof EffectUiAssets.Type
  ) {
    const rendered = yield* HtmlServer.renderToHtml(NewsPage, props);

    const handoff = yield* Schema.encodeEffect(NewsHandoff)({
      props,
      state: rendered.state,
    });

    return yield* renderEffectUiCafe(
      page,
      newsRootId,
      rendered.html,
      newsHandoffId,
      handoff,
      assets
    );
  }
);
