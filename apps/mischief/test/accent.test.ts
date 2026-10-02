import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { homeDocumentHtml } from "../src/bundled-content.generated.js";

const accentSelectors = new Set([
  ":root",
  ":focus-visible",
  ".table-wrapper:focus-visible",
  ".copy:focus-visible",
  ".workshop-callout",
  ".workshop-callout-label",
  ".workshop-callout-apply",
  ".copy-primary",
  ".copy .icon-done",
  ".copy:has(.icon-done:not([hidden]))",
]);

const servedStylesheet = (html: string) =>
  /<style>(?<css>[\s\S]*?)<\/style>/u.exec(html)?.groups?.css ?? "";

const rulesUsingAccent = (css: string) =>
  [...css.matchAll(/(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/gu)].flatMap(
    (match) =>
      /--accent/u.test(match.groups?.body ?? "")
        ? [(match.groups?.selector ?? "").trim()]
        : []
  );

it.effect("uses hot pink only where the accent rule allows", () =>
  Effect.sync(() => {
    const used = rulesUsingAccent(servedStylesheet(homeDocumentHtml));

    expect(
      used.filter((selector) => !accentSelectors.has(selector))
    ).toStrictEqual([]);
    expect(used).toContain(".workshop-callout");
    expect(used).toContain(":focus-visible");
  })
);

it.effect("flags pink on a selector outside the allowed set", () =>
  Effect.sync(() => {
    expect(
      rulesUsingAccent("a {\n  color: var(--accent-text);\n}\n")
    ).toStrictEqual(["a"]);
  })
);
