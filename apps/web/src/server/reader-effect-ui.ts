import { HtmlServer } from "@effect/ui/html";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { init } from "../client/reader/init.js";
import { ReaderFlags } from "../client/reader/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import { readerViewWithCafe } from "../features/reader.js";
import type { EffectUiAssets } from "./reader-document.js";

export const effectUiDocument = (
  assets: typeof EffectUiAssets.Type,
  handoffId: string,
  handoff: Parameters<typeof HtmlServer.serializeState>[0]
) => ({
  effectUi: {
    assets,
    handoff: `<script type="application/json" id="${handoffId}">${HtmlServer.serializeState(handoff)}</script>`,
  },
});

export const renderEffectUiCafe = (
  page: ReaderPageFlags,
  rootId: string,
  html: string,
  handoffId: string,
  handoff: Parameters<typeof HtmlServer.serializeState>[0],
  assets: typeof EffectUiAssets.Type
) =>
  renderToString(
    {
      Flags: ReaderFlags,
      init,
      view: readerViewWithCafe((h) => h.div([h.Id(rootId), h.InnerHTML(html)])),
    },
    { flags: page, isHydratable: false }
  ).pipe(
    Effect.map((application) => ({
      ...application,
      ...effectUiDocument(assets, handoffId, handoff),
    }))
  );
