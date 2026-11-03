import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Layer } from "effect";

import type * as CafePeople from "./cafe-people.js";
import { selectCafeNews, selectCafeProjects } from "./cafe.js";
import type { CafeDataValue } from "./cafe.js";
import {
  AssetReadError,
  listCafeNewsContract,
  listCafeProjectsContract,
  listChannelsContract,
  listPeopleContract,
  peopleForContract,
  readPersonContract,
  searchPeopleContract,
} from "./contracts.js";
import { UnknownPerson } from "./unknown-person.js";

export class CafeDirectory extends Context.Service<
  CafeDirectory,
  { readonly data: Effect.Effect<CafeDataValue, AssetReadError> }
>()("rat-stack/CafeDirectory") {
  static readonly layer = (data: CafeDataValue) =>
    Layer.succeed(CafeDirectory, { data: Effect.succeed(data) });
}

export const listCafeNews = implement(listCafeNewsContract, (query) =>
  CafeDirectory.use((directory) =>
    directory.data.pipe(Effect.map((data) => selectCafeNews(data, query)))
  )
);

export const listCafeProjects = implement(listCafeProjectsContract, (query) =>
  CafeDirectory.use((directory) =>
    directory.data.pipe(Effect.map((data) => selectCafeProjects(data, query)))
  )
);

const peopleLogic = Effect.suspend(() => {
  const loaded: Promise<typeof CafePeople> = import("./cafe-people.js");

  return Effect.tryPromise({
    catch: (cause) =>
      new AssetReadError({ cause, path: "cafe-people", reason: "provider" }),
    try: loaded.finally.bind(loaded, undefined),
  });
});

const withData = <A>(
  select: (people: typeof CafePeople, data: CafeDataValue) => A
) =>
  Effect.all([
    peopleLogic,
    CafeDirectory.use((directory) => directory.data),
  ]).pipe(Effect.map(([people, data]) => select(people, data)));

export const listPeople = implement(listPeopleContract, (query) =>
  withData((people, data) => people.selectCafePeople(data, query))
);

export const listChannels = implement(listChannelsContract, (query) =>
  withData((people, data) =>
    people.selectCafePeople(data, { ...query, kind: "channel" })
  )
);

export const readPerson = implement(readPersonContract, ({ id }) =>
  withData((people, data) => people.findCafePerson(data, id)).pipe(
    Effect.flatMap((found) =>
      Effect.fromOption(found).pipe(
        Effect.mapError(
          () =>
            new UnknownPerson({
              id,
              message: "Choose an id returned by listPeople or searchPeople.",
            })
        )
      )
    )
  )
);

export const searchPeople = implement(searchPeopleContract, (query) =>
  withData((people, data) => people.searchCafePeople(data, query))
);

export const peopleFor = implement(peopleForContract, (query) =>
  withData((people, data) => people.cafePeopleFor(data, query))
);

export const peopleCapabilities = [
  listPeople,
  listChannels,
  readPerson,
  searchPeople,
  peopleFor,
] as const;
