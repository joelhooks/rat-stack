import { selectCafeNews, sortCafeProjects } from "@rat-stack/core/contracts";
import { Effect } from "effect";

import { Model } from "../../web/src/client/cafe/model.ts";
import type { CafeModel } from "../../web/src/client/cafe/model.ts";
import { directoryCopy, newsCopy } from "../../web/src/features/cafe/copy.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

const pageLimit = 100;

export const readerCafeFlags = Effect.fn("readerCafeFlags")(
  function* readerCafeFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;
    const data = inputs.cafe;

    const page = Effect.fn("readerCafeFlags.page")(function* page(
      path: "/news" | "/directory",
      heading: string,
      sourcePath: string,
      cafe: CafeModel
    ) {
      const descriptor = inputs.pages.find((entry) => entry.path === path);

      if (descriptor === undefined) {
        return yield* new ReaderInputError({
          message: `The content manifest has no ${path} page; regenerate content before preparing the reader`,
          sourcePath,
        });
      }

      return {
        agentMarkdown: undefined,
        bibliography: [],
        blocks: [],
        cafe,
        codeFences: [],
        copyPrompts: [],
        heading,
        origin,
        page: {
          generation: inputs.generation,
          metadata: descriptor.metadata,
          path,
          sourcePath,
          status: 200,
        },
        snippets: [],
        terms: [],
      };
    });

    return [
      yield* page(
        "/news",
        newsCopy.heading,
        ".brain/data/cafe/news.json",
        Model.News({
          items: selectCafeNews(data, {
            limit: pageLimit,
            sort: "rank",
          }).items.map((entry) => entry.item),
          rankedAt: data.rankedAt,
        })
      ),
      yield* page(
        "/directory",
        directoryCopy.heading,
        ".brain/data/cafe/projects.json",
        Model.Directory({
          projects: sortCafeProjects(data.projects, "updated"),
          selected: [],
        })
      ),
    ];
  }
);
