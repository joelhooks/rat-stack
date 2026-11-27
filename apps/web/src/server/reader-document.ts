import { Schema } from "effect";
import * as Server from "foldkit/experimental/server";

import {
  appleTouchIconPngBase64,
  faviconIcoBase64,
  ratSvg,
} from "../../../site/src/rat-icons.generated.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import { readerMetadataHead } from "../reader-metadata.js";

export const EffectUiAssets = Schema.Struct({
  entryScript: Schema.String,
  modulePreloads: Schema.Array(Schema.String),
  stylesheets: Schema.Array(Schema.String),
});

const ReaderDocumentHead = Schema.Struct({
  effectUi: Schema.optionalKey(
    Schema.Struct({ assets: EffectUiAssets, handoff: Schema.String })
  ),
  readerHead: Schema.String,
});

const webMcpOriginTrialScript =
  '<script src="/assets/webmcp-origin-trial.js"></script>';

const iconHead = [
  '<meta name="color-scheme" content="light dark">',
  `<link rel="icon" sizes="48x48" href="data:image/x-icon;base64,${faviconIcoBase64}">`,
  `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(ratSvg)}">`,
  `<link rel="apple-touch-icon" href="data:image/png;base64,${appleTouchIconPngBase64}">`,
].join("\n");

export const withReaderHead = (
  application: Server.RenderedApplication,
  page: ReaderPageFlags
) => ({
  ...application,
  readerHead: readerMetadataHead(page.page.metadata, page.origin),
});

export const renderDocument: Server.DocumentRenderer = (
  application,
  assets
) => {
  const { effectUi, readerHead } =
    Schema.decodeUnknownSync(ReaderDocumentHead)(application);

  const documentAssets =
    effectUi === undefined
      ? assets
      : {
          ...assets,
          ...effectUi.assets,
          stylesheets: [
            ...new Set([...effectUi.assets.stylesheets, ...assets.stylesheets]),
          ],
        };

  return Server.renderDocument(application, documentAssets, {
    head: `${iconHead}\n${webMcpOriginTrialScript}\n${readerHead}${effectUi?.handoff ?? ""}`,
  });
};
