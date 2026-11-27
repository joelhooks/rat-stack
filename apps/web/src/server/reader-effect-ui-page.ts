import { HtmlServer } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { ReaderPage } from "../client/reader-effect-ui/component.js";
import {
  ReaderHandoff,
  readerHandoffId,
  readerRootId,
} from "../client/reader-effect-ui/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import { withReaderHead } from "./reader-document.js";
import type { EffectUiAssets } from "./reader-document.js";
import { readerProps } from "./reader-effect-ui-props.js";
import { effectUiDocument } from "./reader-effect-ui.js";

const encodeHandoff = Schema.encodeEffect(ReaderHandoff);

export const renderEffectUiReader = Effect.fn("reader.renderEffectUi")(
  function* renderEffectUiReader(
    page: ReaderPageFlags,
    assets: typeof EffectUiAssets.Type
  ) {
    const props = readerProps(page);
    const rendered = yield* HtmlServer.renderToHtml(ReaderPage, props);
    const handoff = yield* encodeHandoff({ props, state: rendered.state });
    const canonical = `${page.origin}${page.page.metadata.canonicalPath}`;

    return withReaderHead(
      {
        canonical,
        html: `<div id="${readerRootId}">${rendered.html}</div>`,
        ogUrl: canonical,
        title: page.page.metadata.title,
        ...effectUiDocument(assets, readerHandoffId, handoff),
      },
      page
    );
  }
);
