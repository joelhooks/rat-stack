import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  generatedReaderPage,
  generatedTokenmaxxPage,
  homeDocumentHtml,
  staticAssetPageRoutes,
} from "./generated-content.js";

const servedStylesheet =
  /<style>(?<css>[\s\S]*?)<\/style>/u.exec(homeDocumentHtml)?.groups?.css ?? "";

const colorTokens = (body: string) =>
  new Map(
    [...body.matchAll(/--(?<name>[\w-]+):\s*(?<value>#[\da-f]{3,8});/giu)].map(
      (match) => [match.groups?.name ?? "", match.groups?.value ?? ""]
    )
  );

const lightRoot = colorTokens(
  /:root\s*\{(?<body>[^}]*)\}/u.exec(servedStylesheet)?.groups?.body ?? ""
);

const darkRoot = colorTokens(
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{(?<body>[^}]*)\}/u.exec(
    servedStylesheet
  )?.groups?.body ?? ""
);

const userAgentLight = new Map([
  ["page", "#ffffff"],
  ["ink", "#000000"],
  ["link", "#0000ee"],
  ["link-visited", "#551a8b"],
]);

const palettes = {
  dark: new Map([...userAgentLight, ...lightRoot, ...darkRoot]),
  light: new Map([...userAgentLight, ...lightRoot]),
};

const channel = (value: number) => {
  const unit = value / 255;

  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) => {
  const digits = hex.slice(1);

  const full =
    digits.length === 3
      ? digits.replaceAll(/[\da-f]/giu, "$&$&")
      : digits.slice(0, 6);

  const [red, green, blue] = [0, 2, 4].map((offset) =>
    channel(Number.parseInt(full.slice(offset, offset + 2), 16))
  );

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};

const contrast = (one: string, other: string) => {
  const [high, low] = [luminance(one), luminance(other)].toSorted(
    (left, right) => right - left
  );

  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
};

const text = 4.5;

const nonText = 3;

const requirements = [
  ...["page", "surface", "code-highlight"].map((ground) => ["ink", ground]),
  ...[
    "link",
    "link-visited",
    "text-muted",
    "text-quiet",
    "accent-text",
    "code-muted",
  ].map((ink) => [ink, "page"]),
  ...[
    "code-ink",
    "code-keyword",
    "code-literal",
    "code-muted",
    "text-muted",
  ].flatMap((ink) => [
    [ink, "surface"],
    [ink, "code-highlight"],
  ]),
  ["accent-text", "surface"],
  ["on-accent", "accent-text"],
  ["on-pressed", "pressed"],
].map(([ink = "", ground = ""]) => ({ ground, ink, minimum: text }));

const accentRequirements = ["page", "surface"].map((ground) => ({
  ground,
  ink: "accent",
  minimum: nonText,
}));

const highlightedColors = [
  ...staticAssetPageRoutes.map(generatedReaderPage),
  generatedTokenmaxxPage,
]
  .flatMap((html) => [
    ...html.matchAll(/style="(?<style>[^"]*--shiki-dark:[^"]*)"/gu),
  ])
  .map((match) => {
    const entries = new Map(
      (match.groups?.style ?? "").split(";").map((entry) => {
        const [name = "", value = ""] = entry.split(":");

        return [name, value.toLowerCase()];
      })
    );

    return {
      dark: entries.get("--shiki-dark") ?? "",
      light: entries.get("color") ?? "",
    };
  });

const failingOn = (colors: readonly string[], background: string | undefined) =>
  [...new Set(colors)]
    .filter((color) => /^#[\da-f]{6}$/u.test(color))
    .filter((color) => contrast(color, background ?? "#000000") < text)
    .toSorted();

const measured = (palette: ReadonlyMap<string, string>) =>
  [...requirements, ...accentRequirements].map(({ ground, ink, minimum }) => {
    const foreground = palette.get(ink);
    const background = palette.get(ground);

    return {
      minimum,
      name: `${ink} on ${ground}`,
      ratio:
        foreground === undefined || background === undefined
          ? 0
          : contrast(foreground, background),
    };
  });

const HexColor = Schema.String.check(Schema.isPattern(/^#[\da-f]{6}$/u));

it.prop(
  "contrast is symmetric, bounded by 1 and 21, and 1 for a colour against itself",
  { one: Arbitrary.schema(HexColor), other: Arbitrary.schema(HexColor) },
  ({ one, other }) => {
    expect(contrast(one, other)).toBeCloseTo(contrast(other, one), 10);
    expect(contrast(one, other)).toBeGreaterThanOrEqual(1);
    expect(contrast(one, other)).toBeLessThanOrEqual(21);
    expect(contrast(one, one)).toBeCloseTo(1, 10);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 10);
  }
);

it.effect("every dark colour token overrides its light value", () =>
  Effect.sync(() => {
    expect(darkRoot.size).toBeGreaterThan(0);
    expect(
      [...lightRoot.keys()].filter(
        (name) => name !== "accent" && !darkRoot.has(name)
      )
    ).toStrictEqual([]);
    expect(
      [...userAgentLight.keys()].filter((name) => !darkRoot.has(name))
    ).toStrictEqual([]);
  })
);

it.effect("every dark token pair meets WCAG AA", () =>
  Effect.sync(() => {
    expect(
      measured(palettes.dark).filter(({ minimum, ratio }) => ratio < minimum)
    ).toStrictEqual([]);
  })
);

it.effect("every light token pair meets WCAG AA", () =>
  Effect.sync(() => {
    expect(
      measured(palettes.light).filter(({ minimum, ratio }) => ratio < minimum)
    ).toStrictEqual([]);
  })
);

it.effect(
  "every shipped Mocha code colour meets WCAG AA on both dark code backgrounds",
  () =>
    Effect.sync(() => {
      expect(highlightedColors.length).toBeGreaterThan(0);
      const colors = highlightedColors.map(({ dark }) => dark);

      for (const ground of ["surface", "code-highlight"]) {
        expect(
          failingOn(colors, palettes.dark.get(ground)),
          `Mocha code colours on ${ground}`
        ).toStrictEqual([]);
      }
    })
);

it.effect(
  "every shipped Latte code colour meets WCAG AA on both light code backgrounds",
  () =>
    Effect.sync(() => {
      const colors = highlightedColors.map(({ light }) => light);

      for (const ground of ["surface", "code-highlight"]) {
        expect(
          failingOn(colors, palettes.light.get(ground)),
          `Latte code colours on ${ground}`
        ).toStrictEqual([]);
      }
    })
);
