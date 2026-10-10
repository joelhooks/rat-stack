import { expect, it } from "@effect/vitest";

import {
  changeLogRouter,
  glossaryRouter,
  homeRouter,
  learnRouter,
  loreRouter,
  peersRouter,
  promptsRouter,
  searchRouter,
  skillsRouter,
  systemsRouter,
  tokenmaxxRouter,
} from "../src/features/site-route.js";
import { isReaderRoutePath } from "../src/reader-routes.js";

it("every reader page router prints a path the reader route ledger serves", () => {
  const printed = [
    changeLogRouter(),
    glossaryRouter(),
    homeRouter(),
    learnRouter(),
    loreRouter(),
    peersRouter(),
    promptsRouter(),
    searchRouter(),
    skillsRouter(),
    systemsRouter(),
    tokenmaxxRouter(),
  ];

  expect(printed.filter((path) => !isReaderRoutePath(path))).toEqual([]);
});
