import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { homeDocumentHtml } from "./generated-content.js";

const servedStylesheet = (html: string) =>
  /<style>(?<css>[\s\S]*?)<\/style>/u.exec(html)?.groups?.css ?? "";

const rootDeclarations = (css: string) =>
  new Map(
    [
      ...(
        /:root\s*\{(?<body>[^{}]*)\}/u.exec(css)?.groups?.body ?? ""
      ).matchAll(/(?<name>--[\w-]+)\s*:\s*(?<value>[^;]+);/gu),
    ].map((match) => [
      match.groups?.name ?? "",
      (match.groups?.value ?? "").trim(),
    ])
  );

type Theme = "dark" | "light";

const resolve = (
  tokens: ReadonlyMap<string, string>,
  value: string,
  theme: Theme
): string => {
  const reference = /^var\((?<name>--[\w-]+)\)$/u.exec(value)?.groups?.name;

  if (reference !== undefined) {
    return resolve(tokens, tokens.get(reference) ?? "", theme);
  }

  const pair = /^light-dark\((?<light>[^,]+),(?<dark>[^)]+)\)$/u.exec(value);

  if (pair?.groups !== undefined) {
    return resolve(
      tokens,
      (theme === "light" ? pair.groups.light : pair.groups.dark)?.trim() ?? "",
      theme
    );
  }

  return value;
};

const channel = (hex: string, offset: number) => {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (color: string) => {
  const hex = /^#(?<hex>[\da-f]{6})$/iu.exec(color)?.groups?.hex;
  expect(hex, `${color} is a six-digit hex colour`).toBeDefined();

  return hex === undefined
    ? 0
    : 0.2126 * channel(hex, 0) +
        0.7152 * channel(hex, 2) +
        0.0722 * channel(hex, 4);
};

const contrast = (foreground: string, background: string) => {
  const [lighter, darker] = [
    luminance(foreground),
    luminance(background),
  ].toSorted((left, right) => right - left);

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

const codeColors = (tokens: ReadonlyMap<string, string>) =>
  [...tokens.keys()].filter(
    (name) =>
      name.startsWith("--shiki-token-") ||
      name === "--shiki-foreground" ||
      (name.startsWith("--code-") && name !== "--code-highlight")
  );

it.effect(
  "every code token reaches 4.5:1 on the code fill in both themes",
  () =>
    Effect.sync(() => {
      const tokens = rootDeclarations(servedStylesheet(homeDocumentHtml));
      const names = codeColors(tokens);
      expect(names).toContain("--shiki-token-keyword");
      expect(tokens.get("--shiki-background")).toBe("var(--fill)");

      const failing = (["light", "dark"] as const).flatMap((theme) => {
        const fill = resolve(tokens, "var(--fill)", theme);

        return names.flatMap((name) => {
          const ratio = contrast(resolve(tokens, `var(${name})`, theme), fill);

          return ratio < 4.5 ? [`${theme} ${name} ${ratio.toFixed(2)}:1`] : [];
        });
      });

      expect(failing).toStrictEqual([]);
    })
);
