import { expect, it } from "@effect/vitest";
import { personProfile } from "@rat-stack/core/cafe-people";
import { CafePerson, CafePersonEntry } from "@rat-stack/core/contracts";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { allStarsProfileMarkdown } from "../scripts/cafe-pages.js";

it.prop(
  "each entry basis decodes and renders its evidence, but news needs a row",
  {
    rows: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 1 }))
    ),
    serial: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1_000_000, minimum: 1 }))
    ),
  },
  ({ serial, rows }) => {
    const source = `https://example.com/evidence/${serial}`;
    const project = `https://example.com/project/${serial}`;
    const verified = { source, verified: "2026-11-04" };

    const newsRows = Array.from(
      { length: rows },
      (_, index) => `${source}/${index}`
    );

    const cases = [
      {
        basis: "Entered on these /news rows",
        entry: { kind: "news", rows: newsRows },
        links: newsRows,
      },
      {
        basis: "pinned stack package",
        entry: { kind: "stack", package: `@example/p${serial}`, source },
        links: [source, `@example/p${serial}`],
      },
      {
        basis: "code is vendored or credited",
        entry: { kind: "vendored", source },
        links: [source],
      },
      {
        basis: "Public [CAFE work]",
        entry: { kind: "work", project, ...verified },
        links: [project, source, verified.verified],
      },
    ];

    for (const { entry, basis, links } of cases) {
      const decoded = Schema.decodeUnknownSync(CafePersonEntry)(entry);
      expect(Schema.encodeSync(CafePersonEntry)(decoded)).toStrictEqual(entry);

      const person = Schema.decodeUnknownSync(CafePerson)({
        avatar: { path: "/avatars/example.png", ...verified },
        bio: [
          { text: "Builds a library with Effect.", ...verified },
          { text: "Teaches its typed services.", ...verified },
        ],
        entry,
        handles: [
          {
            handle: "example",
            kind: "github",
            url: "https://github.com/example",
            ...verified,
          },
        ],
        id: "example",
        kind: "person",
        name: "Example",
        repos: [],
        topics: [],
        updated: verified.verified,
        videos: [],
      });

      const rendered = allStarsProfileMarkdown(personProfile(person, []));

      const line = rendered
        .split("\n")
        .find((text) => text.startsWith("Why they're here:"));

      expect(line).toContain(basis);

      for (const link of links) {
        expect(line).toContain(link);
      }
    }

    expect(
      Schema.decodeUnknownOption(CafePersonEntry)({ kind: "news", rows: [] })
        ._tag
    ).toBe("None");
  }
);
