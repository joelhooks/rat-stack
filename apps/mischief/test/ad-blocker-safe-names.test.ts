import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  homeDocumentHtml,
  lawSources,
  loreSources,
  skillSources,
} from "../src/bundled-content.generated.js";

const blockerBaitTokens = [
  /^(?:ad|ads|advert|adverts|advertisement)$/u,
  /^(?:ad|ads)[-_]/u,
  /[-_](?:ad|ads)$/u,
  /[-_](?:ad|ads)[-_]/u,
  /house-?ad/iu,
  /banner/iu,
  /sponsor/iu,
  /promo/iu,
];

const classAndIdTokens = (html: string) =>
  [...html.matchAll(/\s(?:class|id)="(?<names>[^"]*)"/gu)].flatMap((match) =>
    (match.groups?.names ?? "").split(/\s+/u).filter((token) => token !== "")
  );

const looksLikeAdvertising = (token: string) =>
  blockerBaitTokens.some((pattern) => pattern.test(token));

it.effect(
  "names no element with a class or id that generic ad-blocker rules hide",
  () =>
    Effect.sync(() => {
      const documents = [
        homeDocumentHtml,
        ...[...lawSources, ...loreSources, ...skillSources].map(
          (source) => source.documentHtml
        ),
      ];

      const offenders = documents.flatMap((html) =>
        classAndIdTokens(html).filter(looksLikeAdvertising)
      );

      expect(offenders).toStrictEqual([]);
      expect(homeDocumentHtml).toContain('class="workshop-callout"');
    })
);

it.effect("flags the names that took the workshop callout down", () =>
  Effect.sync(() => {
    expect(
      classAndIdTokens(
        '<aside class="house-ad x" id="ads-top"></aside>'
      ).filter(looksLikeAdvertising)
    ).toStrictEqual(["house-ad", "ads-top"]);
    expect(looksLikeAdvertising("glossary")).toBe(false);
    expect(looksLikeAdvertising("shadow")).toBe(false);
  })
);
