import { CafeDirectory, listPeople } from "@rat-stack/core/cafe-directory";
import { profileForNewsRow } from "@rat-stack/core/cafe-people";
import { selectCafeNews, sortCafeProjects } from "@rat-stack/core/contracts";
import { Effect, Option } from "effect";

import { Model } from "../../web/src/client/cafe/model.ts";
import type { CafeModel } from "../../web/src/client/cafe/model.ts";
import {
  allStarsCopy,
  directoryCopy,
  newsCopy,
} from "../../web/src/features/cafe/copy.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

const pageLimit = 100;

export const readerCafeFlags = Effect.fn("readerCafeFlags")(
  function* readerCafeFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;
    const data = inputs.cafe;

    const page = Effect.fn("readerCafeFlags.page")(function* page(
      path: "/news" | "/directory" | "/all-stars",
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

    const people = yield* listPeople
      .handler({ limit: pageLimit })
      .pipe(Effect.provide(CafeDirectory.layer(data)));

    const items = selectCafeNews(data, {
      limit: pageLimit,
      sort: "rank",
    }).items.map((entry) => entry.item);

    return [
      yield* page(
        "/news",
        newsCopy.heading,
        ".brain/data/cafe/news.json",
        Model.News({
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
        })
      ),
      yield* page(
        "/all-stars",
        allStarsCopy.heading,
        ".brain/data/cafe/people.json",
        Model.AllStars({ people: people.people })
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
