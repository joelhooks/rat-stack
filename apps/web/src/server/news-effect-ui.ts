import { HtmlServer } from "@effect/ui/html";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { NewsPage } from "../client/news-effect-ui/component.js";
import {
  NewsHandoff,
  newsHandoffId,
  newsRootId,
} from "../client/news-effect-ui/model.js";
import type { NewsPageProps } from "../client/news-effect-ui/model.js";
import { init } from "../client/reader/init.js";
import { ReaderFlags } from "../client/reader/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import { readerViewWithCafe } from "../features/reader.js";
import type { NewsDocumentAssets } from "./reader-document.js";

export const renderNewsPage = Effect.fn("reader.renderNewsPage")(
  function* renderNewsPage(
    page: ReaderPageFlags,
    props: NewsPageProps,
    assets: typeof NewsDocumentAssets.Type
  ) {
    const rendered = yield* HtmlServer.renderToHtml(NewsPage, props);

    const handoff = yield* Schema.encodeEffect(NewsHandoff)({
      props,
      state: rendered.state,
    });

    const application = yield* renderToString(
      {
        Flags: ReaderFlags,
        init,
        view: readerViewWithCafe((h) =>
          h.div([h.Id(newsRootId), h.InnerHTML(rendered.html)])
        ),
      },
      { flags: page, isHydratable: false }
    );

    return {
      ...application,
      news: {
        assets,
        handoff: `<script type="application/json" id="${newsHandoffId}">${HtmlServer.serializeState(handoff)}</script>`,
      },
    };
  }
);
