import { HtmlServer } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { DirectoryPage } from "../client/directory-effect-ui/component.js";
import {
  DirectoryHandoff,
  directoryHandoffId,
  directoryRootId,
} from "../client/directory-effect-ui/model.js";
import type { DirectoryProps } from "../client/directory-effect-ui/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import type { EffectUiAssets } from "./reader-document.js";
import { renderEffectUiCafe } from "./reader-effect-ui.js";

export const renderDirectoryPage = Effect.fn("reader.renderDirectoryPage")(
  function* renderDirectoryPage(
    page: ReaderPageFlags,
    { projects, selected }: typeof DirectoryProps.Type,
    assets: typeof EffectUiAssets.Type
  ) {
    const props = { projects, selected };
    const rendered = yield* HtmlServer.renderToHtml(DirectoryPage, props);

    const handoff = yield* Schema.encodeEffect(DirectoryHandoff)({
      props,
      state: rendered.state,
    });

    return yield* renderEffectUiCafe(
      page,
      directoryRootId,
      rendered.html,
      directoryHandoffId,
      handoff,
      assets
    );
  }
);
