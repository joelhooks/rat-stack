import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { readerBodyFlags } from "../../site/scripts/reader-body-flags.ts";
import { prepareReaderSiteInputs } from "../../site/scripts/reader-site-inputs.ts";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";

const htmlText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

it.effect("every seed profile renders as prerendered HTML", () =>
  Effect.gen(function* renderProfiles() {
    const inputs = yield* prepareReaderSiteInputs;
    const flags = yield* readerBodyFlags("https://ratstack.sh");

    expect(inputs.cafe.people.map((person) => person.id).toSorted()).toEqual([
      "devinjameson",
      "effect-ts",
      "sam-goodwin",
    ]);

    for (const person of inputs.cafe.people) {
      const page = flags.find(
        (candidate) => candidate.page.path === `/all-stars/${person.id}`
      );

      expect(page, person.id).toBeDefined();

      if (page === undefined) {
        return;
      }

      const rendered = yield* renderToString(
        { Flags: ReaderFlags, init, view },
        { flags: page, isHydratable: false }
      );

      expect(page.heading).toBe(person.name);
      expect(rendered.html).toContain(`src="${person.avatar.path}"`);
      expect(rendered.html).toContain("To be removed from this page");

      for (const fact of person.bio) {
        expect(rendered.html).toContain(htmlText(fact.source));
      }
    }

    const index = flags.find(
      (candidate) => candidate.page.path === "/all-stars"
    );

    expect(index?.heading).toBe("CAFE all stars");
  }).pipe(Effect.provide(NodeServices.layer))
);
