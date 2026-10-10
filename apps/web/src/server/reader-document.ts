import { Schema } from "effect";
import * as Server from "foldkit/experimental/server";

import {
  appleTouchIconPngBase64,
  faviconIcoBase64,
  ratSvg,
} from "../../../mischief/src/rat-icons.generated.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import { readerMetadataHead } from "../reader-metadata.js";

const ReaderDocumentHead = Schema.Struct({ readerHead: Schema.String });

const iconHead = [
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

export const renderDocument: Server.DocumentRenderer = (application, assets) =>
  Server.renderDocument(application, assets, {
    head: `${iconHead}\n${Schema.decodeUnknownSync(ReaderDocumentHead)(application).readerHead}`,
  });
