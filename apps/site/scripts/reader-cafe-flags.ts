import { CafeDirectory, listPeople } from "@rat-stack/core/cafe-directory";
import { profileForNewsRow } from "@rat-stack/core/cafe-people";
import { sortCafeProjects } from "@rat-stack/core/contracts";
import { Effect, Option } from "effect";

import {
  allStarsCopy,
  directoryCopy,
  newsCopy,
} from "../../web/src/features/cafe/copy.ts";
import { newsOrder } from "../../web/src/features/cafe/news-order.ts";
import { CafePage } from "../../web/src/reader-cafe.ts";
import { cafeNewsPageItems } from "./cafe-pages.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

const pageLimit = 100;

export const readerCafeFlags = Effect.fn("readerCafeFlags")(
  function* readerCafeFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;
    const data = inputs.cafe;

    const page = Effect.fn("readerCafeFlags.page")(function* page(
      path: "/news" | "/news/latest" | "/directory" | "/all-stars",
      heading: string,
      sourcePath: string,
      cafe: typeof CafePage.Type
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

    const people = yield* listPeople
      .handler({ limit: pageLimit })
      .pipe(Effect.provide(CafeDirectory.layer(data)));

    const newsPage = (sort: keyof typeof newsOrder) => {
      const items = cafeNewsPageItems(data, sort);

      return page(
        newsOrder[sort].href,
        sort === "rank" ? newsCopy.heading : newsOrder.newest.heading,
        ".brain/data/cafe/news.json",
        CafePage.cases.News.make({
          items,
          profiles: items.flatMap((item) =>
            Option.toArray(
              Option.map(profileForNewsRow(people.people, item), (person) => ({
                name: person.name,
                route: person.route,
                url: item.url,
              }))
            )
          ),
          rankedAt: data.rankedAt,
          sort,
        })
      );
    };

    return [
      yield* newsPage("rank"),
      yield* newsPage("newest"),
      yield* page(
        "/all-stars",
        allStarsCopy.heading,
        ".brain/data/cafe/people.json",
        CafePage.cases.AllStars.make({ people: people.people })
      ),
      yield* page(
        "/directory",
        directoryCopy.heading,
        ".brain/data/cafe/projects.json",
        CafePage.cases.Directory.make({
          projects: sortCafeProjects(data.projects, "updated"),
          selected: [],
        })
      ),
    ];
  }
);
