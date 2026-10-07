import { Effect } from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import { houseAdCopy } from "../src/house-ad-copy.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

export const readerPrototypeFlags = Effect.fn("readerPrototypeFlags")(
  function* readerPrototypeFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;

    const page = inputs.pages.find(
      (entry) => entry.path === inputs.lore.routePath
    );

    if (page === undefined) {
      return yield* Effect.die(
        new Error("The selected lore route has no generated page")
      );
    }

    const document = parseDocument(page.html, {
      withEndIndices: true,
      withStartIndices: true,
    });

    const figures = DomUtils.getElementsByTagName(
      "figure",
      document.children
    ).filter((element) =>
      (element.attribs.class ?? "").split(/\s+/u).includes("code-snippet")
    );

    if (figures.length !== 2) {
      return yield* Effect.die(
        new Error(
          `Expected two resolved lore excerpts, received ${figures.length}`
        )
      );
    }

    const readSnippet = (figure: (typeof figures)[number]) =>
      Effect.try({
        catch: (cause) =>
          new ReaderInputError({
            cause,
            message:
              "Cannot decode resolved excerpt provenance; regenerate the pinned lore excerpts",
            sourcePath: "/lore/services-capture-dependencies",
          }),
        try: () => {
          const anchor = DomUtils.getElementsByTagName(
            "a",
            figure.children
          ).find((element) =>
            (element.attribs.href ?? "").startsWith(
              "https://github.com/joelhooks/rat-stack/blob/"
            )
          );

          if (anchor === undefined || anchor.attribs.href === undefined) {
            throw new ReaderInputError({
              message:
                "Code excerpt lacks a pinned source link; restore its commit and range",
              sourcePath: "/lore/services-capture-dependencies",
            });
          }

          const url = new URL(anchor.attribs.href);

          const match =
            /^\/joelhooks\/rat-stack\/blob\/(?<at>[\da-f]{40})\/(?<path>.+)$/u.exec(
              url.pathname
            );

          const range = /^#L(?<start>\d+)-L(?<end>\d+)$/u.exec(url.hash);

          if (
            match?.groups?.at === undefined ||
            match.groups.path === undefined ||
            range?.groups?.start === undefined ||
            range.groups.end === undefined ||
            figure.startIndex === null ||
            figure.endIndex === null
          ) {
            throw new ReaderInputError({
              message: `Code excerpt source link has no exact commit and range: ${anchor.attribs.href}; restore the pinned reference`,
              sourcePath: "/lore/services-capture-dependencies",
            });
          }

          return {
            at: match.groups.at,
            html: page.html.slice(figure.startIndex, figure.endIndex + 1),
            lines: `${range.groups.start}-${range.groups.end}`,
            path: match.groups.path,
            repo: "rat-stack",
          };
        },
      });

    const snippets = yield* Effect.forEach(readSnippet)(figures);

    return {
      bibliography: inputs.lore.bibliography,
      codeFences: [],
      copyPrompts: [],
      heading: page.metadata.title.replace(/ \| rat-stack$/u, ""),
      origin,
      page: {
        generation: inputs.generation,
        metadata: {
          ...page.metadata,
          dateModified: inputs.lore.dateModified,
          datePublished: inputs.lore.datePublished,
        },
        path: page.path,
        sourcePath: inputs.lore.sourcePath,
        status: page.status,
      },
      snippets,
      terms: inputs.lore.terms,
      workshop: houseAdCopy,
    };
  }
);
