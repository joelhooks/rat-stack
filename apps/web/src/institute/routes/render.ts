import { HtmlServer } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { readerMetadataHead } from "../../reader-metadata.js";
import type { EffectUiAssets } from "../../server/reader-document.js";
import { effectUiDocument } from "../../server/reader-effect-ui.js";
import { InstitutePage } from "./component.js";
import {
  InstituteHandoff,
  instituteDescription,
  instituteHandoffId,
  instituteRootId,
  instituteTitle,
} from "./model.js";
import type { InstituteProps } from "./model.js";
import {
  chapterPath,
  instituteCreditsPath,
  instituteOrigin,
  institutePath,
  ogPath,
} from "./paths.js";

const institutePageMetadata = (props: InstituteProps) => {
  if (props.kind === "chapter") {
    return {
      canonicalPath: chapterPath(props.chapter.id),
      description: props.chapter.description,
      title: `${props.chapter.title} | ${instituteTitle}`,
    };
  }

  if (props.kind === "credits") {
    return {
      canonicalPath: instituteCreditsPath,
      description: "Credits for the Ratstack Institute.",
      title: `Credits | ${instituteTitle}`,
    };
  }

  return {
    canonicalPath: institutePath,
    description: instituteDescription,
    title: instituteTitle,
  };
};

export const renderInstitute = Effect.fn("institute.render")(
  function* renderInstitute(
    props: InstituteProps,
    assets: typeof EffectUiAssets.Type,
    discoverable: boolean
  ) {
    const rendered = yield* HtmlServer.renderToHtml(InstitutePage, props);

    const handoff = yield* Schema.encodeEffect(InstituteHandoff)({
      props,
      state: rendered.state,
    });

    const { canonicalPath, description, title } = institutePageMetadata(props);

    const canonical = `${instituteOrigin}${canonicalPath}`;

    const metadata = readerMetadataHead(
      {
        canonicalPath,
        description,
        discoveryLinks: [],
        jsonLd: "none",
        ogImagePath: ogPath,
        robots: "index",
        title,
      },
      instituteOrigin
    );

    return {
      canonical,
      html: `<div id="${instituteRootId}">${rendered.html}</div>`,
      ogUrl: canonical,
      readerHead: discoverable
        ? metadata
        : `${metadata}\n<meta name="robots" content="noindex, nofollow">`,
      title,
      ...effectUiDocument(assets, instituteHandoffId, handoff),
    };
  }
);
